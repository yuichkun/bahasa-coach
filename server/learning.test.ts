import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { Tutor } from "./tutor.ts";
import { FakeBackend, exercise, feedback } from "./fixtures.test-helper.ts";
import type { Feedback } from "../shared/types.ts";
let store: Store, backend: FakeBackend, tutor: Tutor;
const answer = "Saya setuju karena.";
const result: Feedback = {
  ...feedback,
  natural: "Saya setuju karena waktunya cukup.",
  points: [
    {
      original: answer,
      suggestion: "Saya setuju karena waktunya cukup.",
      reason: "理由を最後まで添える",
    },
  ],
  nextFocus: [],
};
beforeEach(() => {
  store = new Store(":memory:");
  backend = new FakeBackend();
  tutor = new Tutor(backend, store);
});
afterEach(() => store.close());
async function propose() {
  const l = store.create("writing", "ja-id", "理由");
  store.exercise(l.id, exercise);
  backend.result = result;
  const evaluated = await tutor.evaluate(l.id, answer, randomUUID());
  return evaluated.review!.focus!;
}
function retry(focusId: string, mode: "retry" | "transfer" = "retry") {
  const l = store.create("writing", "ja-id", "理由");
  store.learning.attach(l.id, focusId, mode);
  store.exercise(l.id, exercise);
  return l;
}
describe("practice lifecycle", () => {
  it("does not advance learning just because feedback was displayed", async () => {
    const focus = await propose();
    expect(focus.state).toBe("proposed");
    expect(store.learning.due()).toBeNull();
  });
  it("rejects invented feedback and quotations from the coach", async () => {
    const l = store.create("voice", "ja-id", "自由会話");
    store.fragment(l.id, {
      event_id: "c",
      type: "session.output_transcript.delta",
      delta: answer,
      start_ms: 0,
      end_ms: 1000,
    });
    store.fragment(l.id, {
      event_id: "u",
      type: "session.input_transcript.delta",
      delta: "Ya, saya paham.",
      start_ms: 1500,
      end_ms: 2000,
    });
    backend.result = result;
    const reviewed = await tutor.evaluate(l.id, "", randomUUID());
    expect(reviewed.review).toEqual({ status: "uncertain", focus: null });
    expect(reviewed.attempts[0].feedback.points).toEqual([]);
  });
  it("uses a checked retry in a new situation and records the actual evidence", async () => {
    const focus = await propose(),
      practice = retry(focus.id),
      newAnswer = "Aku setuju, soalnya waktunya cukup.";
    backend.result = {
      outcome: "pass",
      evidence: newAnswer,
      explanation: "理由まで伝えられています。",
    };
    const checked = await tutor.evaluate(practice.id, newAnswer, randomUUID());
    expect(checked.practice!.check!.assisted).toBe(false);
    expect(store.learning.focus(focus.id).state).toBe("transfer_due");
    const next = store.create("writing", "ja-id", "代案");
    backend.result = { ...exercise, prompt: "同僚の予定変更に賛成し、その理由を伝えてください。" };
    await tutor.exercise(next.id, next.kind, next.direction, next.topic);
    expect(store.get(next.id).practice?.mode).toBe("transfer");
    expect(backend.calls.at(-1)).toContain("DIFFERENT concrete situation");
    const transferred = "Aku pilih hari Jumat karena timnya bisa hadir.";
    backend.result = {
      outcome: "pass",
      evidence: transferred,
      explanation: "別の状況でも理由を添えられました。",
    };
    await tutor.evaluate(next.id, transferred, randomUUID());
    expect(store.learning.focus(focus.id).state).toBe("transferred");
    expect(store.learning.due()).toBeNull();
  });
  it("does not record a hint-assisted answer as independent success", async () => {
    const focus = await propose(),
      practice = retry(focus.id),
      newAnswer = "Aku setuju karena waktunya cukup.";
    store.learning.hint(practice.id);
    backend.result = {
      outcome: "pass",
      evidence: newAnswer,
      explanation: "理由まで表現できました。",
    };
    const checked = await tutor.evaluate(practice.id, newAnswer, randomUUID());
    expect(checked.practice?.check?.assisted).toBe(true);
    expect(store.learning.focus(focus.id).state).toBe("practicing");
    expect(store.learning.due()).toBeNull();
  });
  it("does not change the recorded support level when a hint is read after checking", async () => {
    const focus = await propose(),
      practice = retry(focus.id),
      newAnswer = "Aku setuju karena waktunya cukup.";
    backend.result = { outcome: "pass", evidence: newAnswer, explanation: "伝えられています。" };
    await tutor.evaluate(practice.id, newAnswer, randomUUID());
    store.learning.hint(practice.id);
    expect(store.get(practice.id).practice?.check?.assisted).toBe(false);
  });
  it("keeps uncertainty and unsuccessful retries from advancing the cycle", async () => {
    const focus = await propose(),
      practice = retry(focus.id);
    backend.result = { outcome: "pass", evidence: "invented", explanation: "passed" };
    const checked = await tutor.evaluate(practice.id, "Belum bisa.", randomUUID());
    expect(checked.practice?.check?.outcome).toBe("uncertain");
    expect(store.learning.focus(focus.id).state).toBe("practicing");
    backend.result = {
      outcome: "retry",
      evidence: "Belum bisa.",
      explanation: "理由も添えてみてください。",
    };
    await tutor.evaluate(practice.id, "Belum bisa.", randomUUID());
    expect(store.learning.due()).toBeNull();
  });
  it("does not generate an artificial exercise when no change is justified", async () => {
    const l = store.create("writing", "ja-id", "理由");
    backend.result = { ...result, points: [] };
    const reviewed = await tutor.evaluate(l.id, "Aku setuju.", randomUUID());
    expect(reviewed.review).toEqual({ status: "clear", focus: null });
  });
  it("invalidates a practice target after its source transcript is corrected", async () => {
    const l = store.create("voice", "ja-id", "理由");
    store.fragment(l.id, {
      event_id: "u",
      type: "session.input_transcript.delta",
      delta: answer,
      start_ms: 0,
      end_ms: 1000,
    });
    backend.result = result;
    const reviewed = await tutor.evaluate(l.id, "", randomUUID()),
      focus = reviewed.review!.focus!,
      row = reviewed.rows[0];
    store.revise(l.id, row.id, row.original, "Saya setuju karena waktunya cukup.");
    expect(store.learning.focus(focus.id).state).toBe("withdrawn");
    expect(store.get(l.id).review?.status).toBe("stale");
  });
  it("retains an uncertain recognition instead of treating it as a learner error", async () => {
    const l = store.create("voice", "ja-id", "理由");
    store.fragment(l.id, {
      event_id: "u",
      type: "session.input_transcript.delta",
      delta: answer,
      start_ms: 0,
      end_ms: 1000,
    });
    const row = store.rows(l.id)[0];
    store.revise(l.id, row.id, row.original, "Saya setuju.");
    store.fragment(l.id, {
      event_id: "late",
      type: "session.input_transcript.delta",
      delta: "嗯",
      start_ms: 1000,
      end_ms: 1100,
    });
    await expect(tutor.evaluate(l.id, "", randomUUID())).rejects.toThrow("確認できる");
    expect(backend.calls).toHaveLength(0);
  });
  it("caches word meanings by context and coalesces duplicate lookups", async () => {
    backend.result = { term: "bisa", meaning: "できる", formal: "bisa", note: "" };
    const [a, b] = await Promise.all([
      tutor.lookup("bisa", "Aku bisa datang."),
      tutor.lookup("bisa", "Aku bisa datang."),
    ]);
    expect(a).toEqual(b);
    expect(backend.calls).toHaveLength(1);
    await tutor.lookup("bisa", "Aku bisa datang.");
    expect(backend.calls).toHaveLength(1);
    backend.result = { term: "bisa", meaning: "毒", formal: "bisa", note: "この文脈では毒" };
    expect((await tutor.lookup("bisa", "Bisa ular itu berbahaya.")).meaning).toBe("毒");
    expect(backend.calls).toHaveLength(2);
  });
  it("produces three reply examples for the current coach utterance without writing a learner answer", async () => {
    const l = store.create("voice", "ja-id", "自由会話");
    store.fragment(l.id, {
      event_id: "c",
      type: "session.output_transcript.delta",
      delta: "Apa rencanamu besok?",
      start_ms: 0,
      end_ms: 1000,
    });
    backend.result = {
      hints: [
        { text: "Aku mau kerja.", intent: "仕事の予定" },
        { text: "Belum tahu.", intent: "まだ未定" },
        { text: "Kalau kamu?", intent: "相手に聞く" },
      ],
    };
    const hints = await tutor.replyHints(l.id, "Apa rencanamu besok?");
    expect(hints.hints).toHaveLength(3);
    expect(store.rows(l.id).every((r) => r.role === "assistant")).toBe(true);
    await expect(tutor.replyHints(l.id, "stale question")).rejects.toThrow("更新");
  });
});
