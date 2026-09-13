import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.ts";
import { Tutor } from "./tutor.ts";
import { FakeBackend } from "./fixtures.test-helper.ts";
let store: Store, tutor: Tutor, backend: FakeBackend, id: string;
const result = {
  outcome: "correction",
  original: "Aku mau pergi di kantor.",
  natural: "Aku mau pergi ke kantor.",
  explanation: "行き先には ke を使います。",
  annotations: [{ term: "ke", meaning: "〜へ", formal: "ke", note: "行き先" }],
};
function fragment(delta = result.original, role = "user", start = 0) {
  store.fragment(id, {
    event_id: crypto.randomUUID(),
    type: role === "user" ? "session.input_transcript.delta" : "session.output_transcript.delta",
    delta,
    start_ms: start,
    end_ms: start + 1000,
  });
  tutor.speech.schedule(id);
}
beforeEach(() => {
  vi.useFakeTimers();
  store = new Store(":memory:");
  backend = new FakeBackend();
  backend.result = structuredClone(result);
  tutor = new Tutor(backend, store);
  id = store.create("voice", "ja-id", "自由会話").id;
  store.status(id, "active");
});
afterEach(() => {
  tutor.speech.close();
  store.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("checks accumulated speech without blocking conversation or overwriting the transcript", async () => {
  const updated = vi.fn();
  tutor.speech.onChange = updated;
  fragment("Aku mau ");
  await vi.advanceTimersByTimeAsync(1500);
  fragment("pergi di kantor.", "user", 1100);
  await vi.advanceTimersByTimeAsync(2000);
  expect(backend.calls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(300);
  const lesson = store.get(id);
  expect(lesson.status).toBe("active");
  expect(lesson.rows[0].original).toBe(result.original);
  expect(lesson.rows[0].corrected).toBeNull();
  expect(lesson.speechFeedback?.[0].result).toEqual(result);
  expect(lesson.attempts).toHaveLength(0);
  expect(updated).toHaveBeenCalledTimes(2);
  fragment("Oke, sampai nanti.", "assistant", 3000);
  await vi.advanceTimersByTimeAsync(3000);
  expect(backend.calls).toHaveLength(1);
});

it("discards an in-flight partial result when the learner continues, then checks the new text", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.spyOn(backend, "requestJson").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fragment();
  await vi.advanceTimersByTimeAsync(2300);
  fragment(" Tapi besok.", "user", 1200);
  finish(result);
  await vi.advanceTimersByTimeAsync(1);
  expect(store.get(id).speechFeedback).toEqual([]);
  await vi.advanceTimersByTimeAsync(2300);
  expect(request).toHaveBeenCalledTimes(2);
  expect(store.get(id).speechFeedback?.[0].source).toBe(result.original + " Tapi besok.");
});

it.each(["clear", "uncertain"])(
  "does not turn %s speech into an invented correction",
  async (outcome) => {
    backend.result = { ...result, outcome };
    fragment("Aku mau、えっと、deadline 是明天？");
    await vi.advanceTimersByTimeAsync(2300);
    const lesson = store.get(id);
    expect(lesson.speechFeedback?.[0].result).toEqual({
      outcome,
      original: "",
      natural: "",
      explanation: "",
      annotations: [],
    });
    expect(lesson.rows[0].original).toBe("Aku mau、えっと、deadline 是明天？");
    expect(backend.calls[0]).toContain("TEXT ONLY");
    expect(backend.calls[0]).toContain("Never correct Japanese/English/Chinese questions");
    expect(lesson.review).toBeNull();
  },
);

it.each(["The coach said this.", "Aku mau pergi ke kantor."])(
  "rejects ungrounded or unchanged suggestions: %s",
  async (original) => {
    backend.result = { ...result, original };
    fragment();
    await vi.advanceTimersByTimeAsync(2300);
    expect(store.get(id).speechFeedback?.[0].result?.outcome).toBe("uncertain");
  },
);

it("hides a completed correction when late transcript fragments change its source", async () => {
  fragment();
  await vi.advanceTimersByTimeAsync(2300);
  fragment(" Eh, maksudku ke kantor.", "user", 1200);
  expect(store.get(id).speechFeedback).toEqual([]);
});

it("retries a provider failure once and allows an explicit retry while keeping the voice active", async () => {
  backend.failure = new Error("offline");
  fragment();
  await vi.advanceTimersByTimeAsync(2300);
  expect(store.get(id).speechFeedback?.[0].status).toBe("pending");
  await vi.advanceTimersByTimeAsync(5100);
  expect(backend.calls).toHaveLength(2);
  const note = store.get(id).speechFeedback![0];
  expect(note.status).toBe("error");
  expect(store.get(id).status).toBe("active");
  tutor.speech.schedule(id);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(backend.calls).toHaveLength(2);
  backend.failure = null;
  tutor.speech.schedule(id, note.blockId);
  await vi.advanceTimersByTimeAsync(2300);
  expect(store.get(id).speechFeedback?.[0].status).toBe("ready");
});

it("does not lose the final pending check when the conversation ends", async () => {
  fragment();
  store.status(id, "completed");
  await vi.advanceTimersByTimeAsync(2300);
  expect(store.get(id).speechFeedback?.[0].result).toEqual(result);
});

it("cancels pending checks on shutdown and ignores results arriving after close", async () => {
  let finish!: (value: unknown) => void;
  vi.spyOn(backend, "requestJson").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fragment();
  await vi.advanceTimersByTimeAsync(2300);
  tutor.speech.close();
  const write = vi.spyOn(store, "saveSpeechFeedback");
  finish(result);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(write).not.toHaveBeenCalled();
});

it("resumes a persisted pending check after the service restarts", async () => {
  vi.spyOn(backend, "requestJson").mockImplementationOnce(() => new Promise(() => {}));
  fragment();
  await vi.advanceTimersByTimeAsync(2300);
  expect(store.get(id).speechFeedback?.[0].status).toBe("pending");
  tutor.speech.close();
  tutor = new Tutor(backend, store);
  tutor.speech.resumePending();
  await vi.advanceTimersByTimeAsync(2300);
  expect(store.get(id).speechFeedback?.[0].result).toEqual(result);
});
it("persists feedback across restart and supplies it to future exercises without repeating checks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bahasa-speech-test-"));
  const path = join(dir, "test.sqlite");
  tutor.speech.close();
  store.close();
  store = new Store(path);
  tutor = new Tutor(backend, store);
  id = store.create("voice", "ja-id", "仕事").id;
  fragment();
  await vi.advanceTimersByTimeAsync(2300);
  store.status(id, "completed");
  tutor.speech.close();
  store.close();
  store = new Store(path);
  tutor = new Tutor(backend, store);
  expect(store.get(id).speechFeedback?.[0].result).toEqual(result);
  expect(store.history()[0].speechFeedback?.[0].result).toEqual(result);
  tutor.speech.schedule(id);
  await vi.advanceTimersByTimeAsync(3000);
  expect(backend.calls).toHaveLength(1);
  tutor.speech.close();
  store.close();
  store = new Store(":memory:");
  rmSync(dir, { recursive: true, force: true });
});
