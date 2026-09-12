import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Attempt,
  Direction,
  Exercise,
  Feedback,
  Kind,
  Lesson,
  TranscriptRow,
} from "../shared/types.ts";

type Row = Record<string, any>;
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY, kind TEXT NOT NULL, direction TEXT NOT NULL, topic TEXT NOT NULL, exercise TEXT, draft TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id), answer TEXT NOT NULL, feedback TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS transcript_rows(id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id), role TEXT NOT NULL, start_ms REAL NOT NULL, end_ms REAL NOT NULL, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS fragments(event_id TEXT NOT NULL, lesson_id TEXT NOT NULL REFERENCES lessons(id), row_id TEXT NOT NULL REFERENCES transcript_rows(id), delta TEXT NOT NULL, start_ms REAL NOT NULL, end_ms REAL NOT NULL, arrival INTEGER PRIMARY KEY AUTOINCREMENT, UNIQUE(lesson_id,event_id));
      CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, row_id TEXT NOT NULL REFERENCES transcript_rows(id), original TEXT NOT NULL, corrected TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_usage(lesson_id TEXT PRIMARY KEY REFERENCES lessons(id), provider_id TEXT, seconds REAL NOT NULL DEFAULT 0, confirmed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    `);
  }
  create(kind: Kind, direction: Direction, topic: string) {
    const id = randomUUID(),
      now = Date.now();
    this.db
      .prepare(
        "INSERT INTO lessons(id,kind,direction,topic,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, kind, direction, topic, now, now);
    return this.get(id);
  }
  get(id: string): Lesson {
    const r = this.db.prepare("SELECT * FROM lessons WHERE id=?").get(id) as Row | undefined;
    if (!r) throw Object.assign(new Error("練習が見つかりません。"), { statusCode: 404 });
    const exercise: Exercise | null = r.exercise ? JSON.parse(r.exercise) : null;
    return {
      id: r.id,
      kind: r.kind,
      direction: r.direction,
      topic: r.topic,
      title: exercise?.title || r.topic || (r.kind === "voice" ? "会話の練習" : "作文の練習"),
      exercise,
      draft: r.draft,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      rows: this.rows(id),
      attempts: (
        this.db
          .prepare("SELECT * FROM attempts WHERE lesson_id=? ORDER BY created_at DESC, rowid DESC")
          .all(id) as Row[]
      ).map((a) => ({
        id: a.id,
        answer: a.answer,
        feedback: JSON.parse(a.feedback),
        createdAt: a.created_at,
      })),
    };
  }
  list(limit = 100) {
    return (
      this.db.prepare("SELECT id FROM lessons ORDER BY updated_at DESC LIMIT ?").all(limit) as Row[]
    ).map((r) => this.get(r.id));
  }
  history(exclude?: string) {
    return (
      this.db
        .prepare(
          "SELECT id FROM lessons WHERE id != ? AND (status IN ('completed','interrupted') OR EXISTS (SELECT 1 FROM attempts WHERE lesson_id=lessons.id)) ORDER BY updated_at DESC LIMIT 10",
        )
        .all(exclude || "") as Row[]
    ).map((r) => {
      const l = this.get(r.id);
      return {
        kind: l.kind,
        topic: l.topic,
        prompt: l.exercise?.prompt,
        answer: l.attempts[0]?.answer,
        feedback: l.attempts[0]?.feedback,
        conversation: l.rows.slice(-30).map((t) => ({
          role: t.role,
          text: t.corrected ?? t.original,
          recognitionUncertain: t.revisionStale,
        })),
      };
    });
  }
  exercise(id: string, value: Exercise) {
    this.db
      .prepare("UPDATE lessons SET exercise=?, updated_at=? WHERE id=?")
      .run(JSON.stringify(value), Date.now(), id);
    return this.get(id);
  }
  draft(id: string, value: string) {
    this.db
      .prepare("UPDATE lessons SET draft=?, updated_at=? WHERE id=? AND draft<>?")
      .run(value, Date.now(), id, value);
    return this.get(id);
  }
  status(id: string, value: Lesson["status"]) {
    this.db
      .prepare("UPDATE lessons SET status=?, updated_at=? WHERE id=?")
      .run(value, Date.now(), id);
  }
  feedback(id: string, answer: string, value: Feedback, requestId: string) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO attempts(id,lesson_id,answer,feedback,created_at) VALUES(?,?,?,?,?)",
      )
      .run(requestId, id, answer, JSON.stringify(value), Date.now());
    this.status(id, "completed");
    return this.get(id);
  }
  attempt(id: string): Attempt | null {
    const r = this.db.prepare("SELECT * FROM attempts WHERE id=?").get(id) as Row | undefined;
    return r
      ? { id: r.id, answer: r.answer, feedback: JSON.parse(r.feedback), createdAt: r.created_at }
      : null;
  }
  rows(lessonId: string): TranscriptRow[] {
    return (
      this.db
        .prepare("SELECT * FROM transcript_rows WHERE lesson_id=? ORDER BY seq")
        .all(lessonId) as Row[]
    ).map((r) => {
      const parts = this.db
        .prepare("SELECT delta FROM fragments WHERE row_id=? ORDER BY start_ms,arrival")
        .all(r.id) as Row[];
      const original = parts.map((p) => p.delta).join("");
      const revision = this.db
        .prepare("SELECT * FROM revisions WHERE row_id=? ORDER BY id DESC LIMIT 1")
        .get(r.id) as Row | undefined;
      return {
        id: r.id,
        role: r.role,
        original,
        corrected: revision?.original === original ? revision.corrected : null,
        revisionStale: Boolean(revision && revision.original !== original),
        startMs: r.start_ms,
        endMs: r.end_ms,
      };
    });
  }
  fragment(
    lessonId: string,
    e: { event_id: string; delta: string; start_ms: number; end_ms: number; type: string },
  ) {
    if (
      this.db
        .prepare("SELECT 1 FROM fragments WHERE lesson_id=? AND event_id=?")
        .get(lessonId, e.event_id)
    )
      return false;
    const role = e.type === "session.input_transcript.delta" ? "user" : "assistant";
    // Display grouping is revisable; it never completes a semantic turn or triggers a tool.
    let row = this.db
      .prepare(
        "SELECT * FROM transcript_rows WHERE lesson_id=? AND role=? AND start_ms<=? AND end_ms>=? ORDER BY ABS(end_ms-?) LIMIT 1",
      )
      .get(lessonId, role, e.end_ms + 1400, e.start_ms - 1400, e.start_ms) as Row | undefined;
    if (
      row &&
      role === "assistant" &&
      e.start_ms > row.end_ms &&
      this.db
        .prepare(
          "SELECT 1 FROM transcript_rows WHERE lesson_id=? AND role='user' AND start_ms>=? AND start_ms<?",
        )
        .get(lessonId, row.end_ms, e.start_ms)
    )
      row = undefined;
    this.db.exec("BEGIN");
    try {
      if (!row) {
        const id = randomUUID();
        const seq = (
          this.db
            .prepare("SELECT COUNT(*) AS n FROM transcript_rows WHERE lesson_id=?")
            .get(lessonId) as Row
        ).n;
        this.db
          .prepare("INSERT INTO transcript_rows VALUES(?,?,?,?,?,?)")
          .run(id, lessonId, role, e.start_ms, e.end_ms, seq);
        row = { id };
      }
      this.db
        .prepare(
          "INSERT INTO fragments(event_id,lesson_id,row_id,delta,start_ms,end_ms) VALUES(?,?,?,?,?,?)",
        )
        .run(e.event_id, lessonId, row.id, e.delta, e.start_ms, e.end_ms);
      this.db
        .prepare(
          "UPDATE transcript_rows SET start_ms=MIN(start_ms,?),end_ms=MAX(end_ms,?) WHERE id=?",
        )
        .run(e.start_ms, e.end_ms, row.id);
      this.db.prepare("UPDATE lessons SET updated_at=? WHERE id=?").run(Date.now(), lessonId);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  revise(lessonId: string, rowId: string, original: string, corrected: string) {
    const row = this.rows(lessonId).find((r) => r.id === rowId);
    if (!row) throw Object.assign(new Error("字幕が見つかりません。"), { statusCode: 404 });
    if (row.original !== original)
      throw Object.assign(
        new Error("字幕が更新されました。最新の原文を確認して再度保存してください。"),
        { statusCode: 409 },
      );
    this.db
      .prepare("INSERT INTO revisions(row_id,original,corrected,created_at) VALUES(?,?,?,?)")
      .run(rowId, original, corrected, Date.now());
    return this.get(lessonId);
  }
  usageStart(id: string, providerId: string) {
    this.db
      .prepare("INSERT INTO voice_usage(lesson_id,provider_id,seconds,created_at) VALUES(?,?,15,?)")
      .run(id, providerId, Date.now());
  }
  usage(id: string, seconds: number, final = false) {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.db
      .prepare(
        "UPDATE voice_usage SET seconds=CASE WHEN ? THEN ? ELSE MAX(seconds,?) END,confirmed=MAX(confirmed,?) WHERE lesson_id=? AND (confirmed=0 OR ?=1)",
      )
      .run(final ? 1 : 0, seconds, seconds, final ? 1 : 0, id, final ? 1 : 0);
  }
  monthUsage() {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    const r = this.db
      .prepare(
        "SELECT COALESCE(SUM(seconds),0) AS seconds,COUNT(CASE WHEN confirmed=0 THEN 1 END) AS unconfirmed FROM voice_usage WHERE created_at>=?",
      )
      .get(d.getTime()) as Row;
    return r as { seconds: number; unconfirmed: number };
  }
  recover() {
    this.db.prepare("UPDATE lessons SET status='interrupted' WHERE status='active'").run();
  }
  close() {
    this.db.close();
  }
}
