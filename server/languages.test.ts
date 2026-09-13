import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.ts";
import { Tutor } from "./tutor.ts";
import { ConversationGuide } from "./conversation.ts";
import { createApp } from "./app.ts";
import { FakeBackend, exercise } from "./fixtures.test-helper.ts";
import { LANGUAGE, LANGUAGES, directionFor } from "../shared/languages.ts";
import { words, glossKey, basicGloss } from "../shared/glossary.ts";
import { translationKey, translationSpans } from "../shared/translation.ts";
import { pinyinSpans } from "../shared/pinyin.ts";

let store: Store, backend: FakeBackend, tutor: Tutor;
beforeEach(() => {
  store = new Store(":memory:");
  backend = new FakeBackend();
  tutor = new Tutor(backend, store);
});
afterEach(() => {
  tutor.speech.close();
  tutor.recap.close();
  tutor.translator.close();
  Object.values(tutor.glossaries).forEach((g) => g.close());
  store.close();
  vi.useRealTimers();
});
function fragment(id: string, text: string) {
  store.fragment(id, {
    event_id: crypto.randomUUID(),
    type: "session.input_transcript.delta",
    delta: text,
    start_ms: 0,
    end_ms: 1000,
  });
}

it("migrates a legacy database without changing its transcript or recognition revisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "bahasa-language-migration-"));
  try {
    const file = join(dir, "test.sqlite");
    const old = new Store(file);
    const lesson = old.create("voice", "ja-id", "過去の練習");
    old.fragment(lesson.id, {
      event_id: "before",
      type: "session.input_transcript.delta",
      delta: "Aku は deadline 是明天？",
      start_ms: 0,
      end_ms: 1000,
    });
    const row = old.rows(lesson.id)[0];
    old.db
      .prepare("INSERT INTO revisions(row_id,original,corrected,created_at) VALUES(?,?,?,?)")
      .run(row.id, row.original, "Aku は deadline 是明天?", 1);
    old.db.exec("ALTER TABLE lessons DROP COLUMN language");
    old.close();
    const migrated = new Store(file);
    try {
      const restored = migrated.get(lesson.id);
      expect(restored.language).toBe("id");
      expect(restored.rows[0].original).toBe(row.original);
      expect(restored.rows[0].corrected).toBe("Aku は deadline 是明天?");
      expect(migrated.create("writing", "ja-en", "依頼").language).toBe("en");
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("separates learner history, due practice and conversational memory by language", () => {
  const lessons = LANGUAGES.map((language) => {
    const lesson = store.create("voice", directionFor(language), language);
    fragment(lesson.id, `private-memory-${language}`);
    store.status(lesson.id, "completed");
    const focus = store.learning.createFocus(lesson.id, {
      original: "source",
      suggestion: "better",
      reason: "理由",
    });
    store.db.prepare("UPDATE practice_focus SET state='transfer_due' WHERE id=?").run(focus.id);
    return { language, lesson, focus };
  });
  const guide = new ConversationGuide(store);
  for (const { language, lesson, focus } of lessons) {
    expect(store.history(undefined, language).map((l) => l.topic)).toEqual([language]);
    expect(store.learning.due(language)?.id).toBe(focus.id);
    const next = store.create("voice", directionFor(language), "次回");
    const first = guide.prepare(next.id);
    expect(first.instructions).toContain(LANGUAGE[language].coach);
    expect(first.instructions).toContain(`private-memory-${language}`);
    for (const other of LANGUAGES.filter((l) => l !== language))
      expect(first.instructions).not.toContain(`private-memory-${other}`);
    store.status(next.id, "paused");
    expect(guide.prepare(next.id)).toEqual(first);
    expect(() =>
      store.learning.attach(
        lessons.find((l) => l.language !== language)!.lesson.id,
        focus.id,
        "transfer",
      ),
    ).toThrow("同じ学習言語");
    expect(store.get(lesson.id).rows[0].original).toBe(`private-memory-${language}`);
  }
});

it.each(LANGUAGES)(
  "uses the %s tutor for both writing directions and replies",
  async (language) => {
    for (const toJapanese of [false, true]) {
      const lesson = store.create("writing", directionFor(language, toJapanese), "依頼");
      backend.result = exercise;
      await tutor.exercise(lesson.id, lesson.kind, lesson.direction, lesson.topic);
      expect(backend.calls.at(-1)).toContain(LANGUAGE[language].target);
      expect(backend.calls.at(-1)).toContain(lesson.direction);
      backend.result = {
        natural: "自然な表現",
        explanation: "理由",
        points: [],
        annotations: [],
        nextFocus: [],
      };
      await tutor.evaluate(lesson.id, "回答", crypto.randomUUID());
      expect(backend.calls.at(-1)).toContain(LANGUAGE[language].target);
    }
  },
);

it("keeps dictionary senses separate in persistent and general caches", async () => {
  backend.result = { term: "air", meaning: "水", formal: "air", note: "" };
  await tutor.glossaries.id.lookup("air", "air");
  backend.result = { term: "air", meaning: "空気", formal: "", note: "" };
  await tutor.glossaries.en.lookup("air", "air");
  expect((await tutor.glossaries.id.lookup("air", "air")).meaning).toBe("水");
  expect((await tutor.glossaries.en.lookup("air", "air")).meaning).toBe("空気");
  expect(backend.calls).toHaveLength(2);
  expect(tutor.glossaries.en.prepare([{ term: "aku", context: "aku" }]).vocabulary).toEqual([]);
  expect(basicGloss("aku", "en")).toBeUndefined();
  expect(glossKey("air", "air", "en")).not.toBe(glossKey("air", "air", "id"));
});

it("checks Mandarin speech containing no Latin letters and preserves the original", async () => {
  vi.useFakeTimers();
  const lesson = store.create("voice", "ja-zh", "会話");
  fragment(lesson.id, "我昨天去银行。");
  backend.result = {
    outcome: "correction",
    original: "我昨天去银行。",
    natural: "我昨天去了银行。",
    explanation: "完了を表します。",
    annotations: [],
  };
  tutor.speech.schedule(lesson.id);
  await vi.advanceTimersByTimeAsync(2300);
  expect(backend.calls[0]).toContain("Mandarin Chinese");
  expect(backend.calls[0]).not.toContain("Never correct Japanese/English/Chinese");
  expect(store.get(lesson.id).speechFeedback?.[0].result?.natural).toBe("我昨天去了银行。");
  expect(store.get(lesson.id).rows[0].original).toBe("我昨天去银行。");
});

it("segments Chinese words, preserves offsets and resolves contextual pinyin", () => {
  const text = "🙂今天去银行，然后行走。日本語です。";
  const tokens = words(text, "zh-Hans");
  expect(tokens.map((t) => t.term)).toContain("银行");
  expect(tokens.map((t) => t.term)).not.toContain("日本語");
  for (const token of tokens)
    expect(text.slice(token.index, token.index + token.term.length)).toBe(token.term);
  const readings = pinyinSpans(text);
  expect(readings.map((p) => p.text).join("")).toBe(text);
  expect(readings.filter((p) => p.text === "行").map((p) => p.reading)).toEqual(["háng", "xíng"]);
  expect(translationSpans("我想学习中文。", "zh-Hans")).toHaveLength(1);
  expect(translationSpans("日本語の質問です。", "zh-Hans")).toEqual([]);
  expect(words("I'd like a check-in.", "en").map((w) => w.term)).toEqual([
    "I'd",
    "like",
    "a",
    "check-in",
  ]);
});

it("does not reuse a sentence translation across learning languages", async () => {
  vi.useFakeTimers();
  const request = { sentence: "air", speaker: "user" as const, before: [], after: [] };
  backend.result = { entries: [{ id: "0", translation: "水" }] };
  const id = tutor.translator.translate(request);
  await vi.advanceTimersByTimeAsync(25);
  expect((await id).translation).toBe("水");
  backend.result = { entries: [{ id: "0", translation: "空気" }] };
  const en = tutor.translator.translate({ ...request, language: "en" });
  await vi.advanceTimersByTimeAsync(25);
  expect((await en).translation).toBe("空気");
  expect(translationKey(request)).not.toBe(translationKey({ ...request, language: "en" }));
  expect(backend.calls).toHaveLength(2);
});

it("validates language and direction at the API and accepts Chinese dictionary words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bahasa-language-api-"));
  const context = await createApp({
    dataDir: dir,
    origin: "http://localhost:43187",
    backend: new FakeBackend(),
  });
  const headers = { host: "localhost:43187", origin: "http://localhost:43187" };
  try {
    for (const language of LANGUAGES) {
      const response = await context.app.inject({
        method: "POST",
        url: "/api/lessons",
        headers,
        payload: { kind: "writing", language, direction: directionFor(language), topic: "依頼" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().language).toBe(language);
    }
    const wrong = await context.app.inject({
      method: "POST",
      url: "/api/lessons",
      headers,
      payload: { kind: "writing", language: "en", direction: "ja-id", topic: "依頼" },
    });
    expect(wrong.statusCode).toBe(400);
    const prepared = await context.app.inject({
      method: "POST",
      url: "/api/glossary/prepare",
      headers,
      payload: { language: "zh-Hans", requests: [{ term: "银行", context: "今天去银行。" }] },
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json().language).toBe("zh-Hans");
    expect(prepared.json().pending).toHaveLength(1);
  } finally {
    await context.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
