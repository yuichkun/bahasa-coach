import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { Feedback, PracticeCheck, PracticeContext, PracticeFocus } from "../shared/types.ts";
import { languageOf, type Language } from "../shared/languages.ts";

type Row = Record<string, any>;
export class LearningStore {
  constructor(privateStore: Store) {
    this.store = privateStore;
  }
  private store: Store;
  init() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS word_lookups(cache_key TEXT PRIMARY KEY, annotation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS practice_focus(id TEXT PRIMARY KEY, source_lesson_id TEXT NOT NULL REFERENCES lessons(id), original TEXT NOT NULL, suggestion TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'proposed', created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lesson_review(lesson_id TEXT PRIMARY KEY REFERENCES lessons(id), status TEXT NOT NULL, focus_id TEXT REFERENCES practice_focus(id));
      CREATE TABLE IF NOT EXISTS lesson_practice(lesson_id TEXT PRIMARY KEY REFERENCES lessons(id), focus_id TEXT NOT NULL REFERENCES practice_focus(id), mode TEXT NOT NULL, hint_used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS practice_checks(id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id), result TEXT NOT NULL, created_at INTEGER NOT NULL);
    `);
  }
  focus(id: string): PracticeFocus {
    const row = this.store.db.prepare("SELECT * FROM practice_focus WHERE id=?").get(id) as
      | Row
      | undefined;
    if (!row) throw Object.assign(new Error("練習する表現が見つかりません。"), { statusCode: 404 });
    return {
      id: row.id,
      sourceLessonId: row.source_lesson_id,
      original: row.original,
      suggestion: row.suggestion,
      reason: row.reason,
      state: row.state,
    };
  }
  review(id: string) {
    const r = this.store.db.prepare("SELECT * FROM lesson_review WHERE lesson_id=?").get(id) as
      | Row
      | undefined;
    return r
      ? {
          status: r.status as "ready" | "clear" | "uncertain" | "stale",
          focus: r.focus_id ? this.focus(r.focus_id) : null,
        }
      : null;
  }
  practice(id: string): PracticeContext | null {
    const r = this.store.db.prepare("SELECT * FROM lesson_practice WHERE lesson_id=?").get(id) as
      | Row
      | undefined;
    if (!r) return null;
    const c = this.store.db
      .prepare(
        "SELECT result FROM practice_checks WHERE lesson_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(id) as Row | undefined;
    return {
      focus: this.focus(r.focus_id),
      mode: r.mode,
      hintUsed: Boolean(r.hint_used),
      check: c ? JSON.parse(c.result) : null,
    };
  }
  saveReview(
    lessonId: string,
    status: "ready" | "clear" | "uncertain",
    point?: Feedback["points"][number],
  ) {
    const previous = this.review(lessonId)?.focus;
    let focusId: string | null = null;
    if (point) {
      if (
        previous &&
        previous.state !== "withdrawn" &&
        previous.original === point.original &&
        previous.suggestion === point.suggestion
      )
        focusId = previous.id;
      else {
        focusId = randomUUID();
        this.store.db
          .prepare(
            "INSERT INTO practice_focus(id,source_lesson_id,original,suggestion,reason,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(focusId, lessonId, point.original, point.suggestion, point.reason, Date.now());
      }
    }
    if (previous && previous.id !== focusId)
      this.store.db
        .prepare("UPDATE practice_focus SET state='withdrawn' WHERE id=?")
        .run(previous.id);
    this.store.db
      .prepare(
        "INSERT INTO lesson_review VALUES(?,?,?) ON CONFLICT(lesson_id) DO UPDATE SET status=excluded.status,focus_id=excluded.focus_id",
      )
      .run(lessonId, status, focusId);
  }
  createFocus(lessonId: string, point: Feedback["points"][number]) {
    const prior = this.store.db
      .prepare(
        "SELECT id FROM practice_focus WHERE source_lesson_id=? AND original=? AND suggestion=? AND state<>'withdrawn' LIMIT 1",
      )
      .get(lessonId, point.original, point.suggestion);
    if (prior) return this.focus(String(prior.id));
    const id = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO practice_focus(id,source_lesson_id,original,suggestion,reason,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, lessonId, point.original, point.suggestion, point.reason, Date.now());
    return this.focus(id);
  }
  attach(lessonId: string, focusId: string, mode: "retry" | "transfer") {
    const focus = this.focus(focusId);
    if (languageOf(this.store.get(lessonId)) !== languageOf(this.store.get(focus.sourceLessonId)))
      throw new Error("同じ学習言語の表現を選んでください。");
    if (focus.state === "withdrawn")
      throw new Error("元の字幕・回答が更新されています。元の練習を確認してください。");
    if (mode === "transfer" && !["transfer_due", "transferred"].includes(focus.state))
      throw new Error("まず言い直し・書き直しを確認してください。");
    this.store.db
      .prepare("INSERT INTO lesson_practice(lesson_id,focus_id,mode) VALUES(?,?,?)")
      .run(lessonId, focusId, mode);
    if (focus.state === "proposed")
      this.store.db.prepare("UPDATE practice_focus SET state='practicing' WHERE id=?").run(focusId);
  }
  due(language: Language = "id") {
    const r = this.store.db
      .prepare(
        "SELECT f.id FROM practice_focus f JOIN lessons l ON l.id=f.source_lesson_id WHERE f.state='transfer_due' AND l.language=? ORDER BY f.created_at LIMIT 1",
      )
      .get(language) as Row | undefined;
    return r ? this.focus(r.id) : null;
  }
  hint(lessonId: string) {
    const p = this.practice(lessonId);
    if (!p) throw new Error("再練習のときに使えます。");
    this.store.db.prepare("UPDATE lesson_practice SET hint_used=1 WHERE lesson_id=?").run(lessonId);
    return p.focus.suggestion;
  }
  check(lessonId: string, requestId: string, check: PracticeCheck) {
    const p = this.practice(lessonId);
    if (!p || p.focus.state === "withdrawn")
      throw new Error("練習の元になる表現が変更されています。");
    const inserted = this.store.db
      .prepare("INSERT OR IGNORE INTO practice_checks VALUES(?,?,?,?)")
      .run(requestId, lessonId, JSON.stringify({ ...check, assisted: p.hintUsed }), Date.now());
    if (!inserted.changes || check.outcome === "uncertain") return;
    const state =
      check.outcome === "pass" && !p.hintUsed
        ? p.mode === "transfer"
          ? "transferred"
          : "transfer_due"
        : p.mode === "transfer"
          ? "transfer_due"
          : "practicing";
    this.store.db.prepare("UPDATE practice_focus SET state=? WHERE id=?").run(state, p.focus.id);
  }
  invalidate(lessonId: string) {
    this.store.db
      .prepare("UPDATE lesson_review SET status='stale' WHERE lesson_id=?")
      .run(lessonId);
    this.store.db
      .prepare("UPDATE practice_focus SET state='withdrawn' WHERE source_lesson_id=?")
      .run(lessonId);
  }
}
