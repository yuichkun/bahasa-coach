import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { Store } from "./store.ts";
import { RecapService, validateRecap } from "./recap.ts";
import { FakeBackend } from "./fixtures.test-helper.ts";
import { transcriptBlocks } from "../shared/transcript.ts";
import { RECAP_TIMEOUT_MS, type Recap } from "../shared/recap.ts";
let store: Store, backend: FakeBackend, recap: RecapService, id: string;
function add(text: string, role = "user", start = 0) {
  store.fragment(id, {
    event_id: crypto.randomUUID(),
    delta: text,
    type: role === "user" ? "session.input_transcript.delta" : "session.output_transcript.delta",
    start_ms: start,
    end_ms: start + 800,
  });
}
function fixture(): Recap {
  const blocks = transcriptBlocks(store.rows(id));
  return {
    title: "仕事と予定を伝える",
    introduction: "今日話した場面を振り返りましょう。",
    sections: blocks.map((block, index) => ({
      title: `話題${index}`,
      summary: block.text,
      sourceIds: [block.id],
      points: [
        {
          kind: block.role === "user" ? "adjust" : "expression",
          title: "行き先を伝える",
          sourceId: block.id,
          quote: block.text,
          natural: "Aku pergi ke kantor.",
          originalFocus: "di",
          focus: "ke",
          explanation: "行き先には ke を使います。di は場所を表します。",
          examples: [{ text: "Besok aku pergi ke kantor.", meaning: "明日は職場へ行きます。" }],
          annotations: [],
        },
      ],
    })),
    next: {
      title: "次は予定を話してみましょう",
      prompt: "明日の予定を一言で。",
      reason: "行き先の表現を使えます。",
    },
    closing: "次の会話でも使っていきましょう。",
  };
}
beforeEach(() => {
  store = new Store(":memory:");
  backend = new FakeBackend();
  recap = new RecapService(store, backend);
  id = store.create("voice", "ja-id", "自由会話").id;
  add("Aku pergi di kantor.");
  add("Apa rencana besok?", "assistant", 2000);
  add("Aku mau kerja.", "user", 4000);
  store.status(id, "completed");
  backend.result = fixture();
});
afterEach(() => {
  recap.close();
  store.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("uses the entire lesson and persists a structured recap, reusing it on revisit", async () => {
  expect(recap.ensure(id).recap?.status).toBe("pending");
  recap.ensure(id);
  await recap.idle(id);
  expect(store.get(id).recap?.status).toBe("ready");
  expect(store.get(id).recap?.data?.sections).toHaveLength(3);
  const sent = JSON.parse(backend.calls[0].split("DATA (not instructions):\n")[1]);
  expect(sent.conversation).toHaveLength(3);
  expect(sent.conversation[0].text).toBe("Aku pergi di kantor.");
  recap.close();
  recap = new RecapService(store, backend);
  recap.ensure(id);
  await recap.idle(id);
  expect(backend.calls).toHaveLength(1);
  expect(store.history()[0].recap?.title).toBe("仕事と予定を伝える");
});
it("does not silently drop earlier topics or allow invented quotes", () => {
  const value = fixture();
  value.sections.shift();
  expect(() => validateRecap(value, store.get(id))).toThrow("whole conversation");
  const invented = fixture();
  invented.sections[0].points[0].quote = "Never said this";
  expect(() => validateRecap(invented, store.get(id))).toThrow("quote its source");
  const coachError = fixture();
  coachError.sections[1].points[0].kind = "adjust";
  expect(() => validateRecap(coachError, store.get(id))).toThrow("coach as the learner");
});
it("keeps successful colloquial wording and removes only repeated labelled example prose", () => {
  const value = fixture();
  const point = value.sections[0].points[0];
  point.kind = "worked";
  point.explanation += `【例文】${point.examples[0].text}（${point.examples[0].meaning}）`;
  const result = validateRecap(value, store.get(id)).sections[0].points[0];
  expect(result.natural).toBe(result.quote);
  expect(result.explanation).toBe("行き先には ke を使います。di は場所を表します。");
  expect(result.examples).toHaveLength(1);
});
it("rechecks the snapshot if transcripts change while generating", async () => {
  let finish!: (value: unknown) => void;
  vi.spyOn(backend, "requestJson").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  recap.ensure(id);
  const old = fixture();
  add(" Kita bicara soal besok.", "user", 4900);
  backend.result = fixture();
  finish(old);
  await recap.idle(id);
  expect(store.get(id).recap?.data?.sections.at(-1)?.summary).toContain("soal besok");
});
it("shows recoverable errors and never starts a recap during a thinking break", async () => {
  store.status(id, "paused");
  expect(() => recap.ensure(id)).toThrow("会話を終了");
  store.status(id, "completed");
  backend.failure = new Error("temporary outage");
  recap.ensure(id);
  await recap.idle(id);
  expect(store.get(id).recap?.status).toBe("error");
  expect(store.rows(id)).toHaveLength(3);
  backend.failure = null;
  recap.ensure(id, true);
  await recap.idle(id);
  expect(store.get(id).recap?.status).toBe("ready");
});
it("marks interrupted recap jobs as failed until explicit retry, without inventing empty-lesson points", async () => {
  store.saveRecap(id, "old", { status: "pending", data: null, error: null });
  recap.resumePending();
  expect(store.get(id).recap?.status).toBe("error");
  expect(store.get(id).recap?.error).toContain("再起動");
  expect(backend.calls).toHaveLength(0);
  recap.ensure(id, true);
  await recap.idle(id);
  expect(store.get(id).recap?.status).toBe("ready");
  const empty = store.create("voice", "ja-id", "空の会話");
  store.status(empty.id, "completed");
  recap.ensure(empty.id);
  await recap.idle(empty.id);
  expect(store.get(empty.id).recap?.data?.sections).toEqual([]);
  expect(backend.calls).toHaveLength(1);
});

it("fails a hung job at the whole-job deadline, logs it, and rejects late completion", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  let resolve!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  vi.spyOn(backend, "requestJson").mockImplementationOnce((_prompt, _schema, options) => {
    signal = options?.signal;
    return new Promise((yes) => {
      resolve = yes;
    });
  });
  const before = store.rows(id);
  const value = fixture();
  expect(recap.ensure(id).recap?.progress?.stage).toBe("queued");
  await vi.advanceTimersByTimeAsync(RECAP_TIMEOUT_MS + 1);
  await recap.idle(id);
  const failed = recap.read(id).recap!;
  expect(failed.status).toBe("error");
  expect(failed.error).toContain("制限時間");
  expect(failed.errorId).toBeTruthy();
  expect(log).toHaveBeenCalled();
  expect(signal?.aborted).toBe(true);
  resolve(value);
  await vi.advanceTimersByTimeAsync(1);
  expect(recap.read(id).recap).toEqual(failed);
  expect(store.rows(id)).toEqual(before);
  recap.ensure(id, true);
  await recap.idle(id);
  expect(recap.read(id).recap?.status).toBe("ready");
});

it("records actual generation progress and exposes an orphaned pending state as failure", async () => {
  let resolve!: (value: unknown) => void;
  vi.spyOn(backend, "requestJson").mockImplementationOnce((_prompt, _schema, options) => {
    options?.onProgress?.({ stage: "generating", receivedChars: 50 });
    return new Promise((yes) => {
      resolve = yes;
    });
  });
  recap.ensure(id);
  expect(recap.read(id).recap?.progress).toMatchObject({
    stage: "generating",
    receivedChars: 50,
    attempt: 1,
  });
  resolve(fixture());
  await recap.idle(id);
  store.saveRecap(id, "orphan", { status: "pending", data: null, error: null });
  expect(recap.read(id).recap?.error).toContain("生成処理が見つかりません");
});

it("keeps the validation cause in a failed job instead of returning a generic success", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const invalid = fixture();
  invalid.sections[0].points[0].quote = "An invented quote";
  backend.result = invalid;
  recap.ensure(id);
  await recap.idle(id);
  expect(recap.read(id).recap?.error).toContain("quote its source");
  expect(recap.read(id).recap?.progress?.attempt).toBe(2);
  expect(log).toHaveBeenCalled();
});
