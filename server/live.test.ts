import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Store } from "./store.ts";
import { Tutor } from "./tutor.ts";
import { FakeBackend } from "./fixtures.test-helper.ts";
import type { AppEvent } from "../shared/types.ts";
const control = vi.hoisted(() => ({ sent: vi.fn(), acknowledge: true }));

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      queueMicrotask(() => this.emit("open"));
    }
    send(raw: string) {
      const e = JSON.parse(raw);
      control.sent(e);
      if (e.type === "session.instructions.append" && control.acknowledge)
        queueMicrotask(() =>
          this.emit(
            "message",
            Buffer.from(
              JSON.stringify({
                type: "session.instructions.appended",
                event_id: crypto.randomUUID(),
                client_event_id: e.event_id,
                start_ms: 4000,
                end_ms: 4300,
              }),
            ),
          ),
        );
      if (e.type === "session.close")
        queueMicrotask(() =>
          this.emit(
            "message",
            Buffer.from(
              JSON.stringify({
                type: "session.closed",
                event_id: "final",
                reason: "close_requested",
                usage: { seconds: 62 },
              }),
            ),
          ),
        );
    }
    close() {
      this.readyState = 3;
      this.emit("close");
    }
  }
  return { default: FakeSocket };
});
import { LiveManager } from "./live.ts";
let store: Store,
  tutor: Tutor,
  live: LiveManager,
  lessonId: string,
  events: AppEvent[],
  fetchMock: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  control.sent.mockClear();
  control.acknowledge = true;
  store = new Store(":memory:");
  lessonId = store.create("voice", "ja-id", "仕事").id;
  events = [];
  tutor = new Tutor(new FakeBackend(), store);
  live = new LiveManager(
    store,
    tutor,
    () => "test-only-key",
    (e) => events.push(e),
  );
  fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(
        JSON.stringify({ session: { id: "live_test" }, transport: { sdp: "test-answer" } }),
        { status: 201 },
      ),
    );
});
afterEach(async () => {
  tutor.speech.close();
  await live.stop();
  store.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it.each(["repeat", "slow", "japanese"])(
  "sends %s as a targeted application control, never as learner speech",
  async (action) => {
    await live.start("owner", lessonId, "test-sdp");
    live.fromBrowser("owner", { type: "session.started", event_id: "started" });
    live.fromBrowser("owner", {
      type: "session.output_transcript.delta",
      event_id: "coach",
      delta: "Apa rencanamu besok?",
      start_ms: 0,
      end_ms: 1000,
    });
    const before = store.rows(lessonId);
    await live.action("owner", action);
    const command = control.sent.mock.calls.at(-1)![0];
    expect(command.type).toBe("session.instructions.append");
    expect(command.delegation_id).toBeNull();
    expect(command.content).toContain("APPLICATION CONTROL, not learner speech");
    expect(command.content).toContain('COACH utterance: "Apa rencanamu besok?"');
    expect(command.content).not.toContain("The learner asks");
    expect(store.rows(lessonId)).toEqual(before);
    expect(store.get(lessonId).speechFeedback).toEqual([]);
    expect(live.info()?.status).toBe("active");
  },
);
it("does not claim a menu command succeeded before acceptance, and reports rejection", async () => {
  control.acknowledge = false;
  await live.start("owner", lessonId, "test-sdp");
  live.fromBrowser("owner", { type: "session.started", event_id: "started" });
  live.fromBrowser("owner", {
    type: "session.output_transcript.delta",
    event_id: "coach",
    delta: "Halo.",
    start_ms: 0,
    end_ms: 1000,
  });
  const pending = live.action("owner", "repeat");
  expect(() => live.action("owner", "slow")).toThrow("前の操作");
  const id = control.sent.mock.calls.at(-1)![0].event_id;
  live.fromBrowser("owner", { type: "error", event_id: "rejected", error: { event_id: id } });
  await expect(pending).rejects.toThrow("受け付けられません");
  expect(store.rows(lessonId).some((r) => r.role === "user")).toBe(false);
});
it("automatically schedules written feedback from microphone transcripts without sending it to Live", async () => {
  await live.start("owner", lessonId, "test-sdp");
  vi.useFakeTimers();
  const backend = tutor.backend as FakeBackend;
  backend.result = {
    outcome: "correction",
    original: "Aku pergi di kantor.",
    natural: "Aku pergi ke kantor.",
    explanation: "行き先には ke。",
    annotations: [],
  };
  live.fromBrowser("owner", {
    type: "session.input_transcript.delta",
    event_id: "learner",
    delta: "Aku pergi di kantor.",
    start_ms: 0,
    end_ms: 1000,
  });
  live.fromBrowser("owner", {
    type: "session.output_transcript.delta",
    event_id: "coach",
    delta: "Jam berapa?",
    start_ms: 1100,
    end_ms: 1600,
  });
  await vi.advanceTimersByTimeAsync(2300);
  expect(store.get(lessonId).speechFeedback?.[0].result?.natural).toBe("Aku pergi ke kantor.");
  expect(control.sent).not.toHaveBeenCalled();
});
it("keeps the original coach target across consecutive replay controls", async () => {
  await live.start("owner", lessonId, "test-sdp");
  live.fromBrowser("owner", { type: "session.started", event_id: "started" });
  live.fromBrowser("owner", {
    type: "session.output_transcript.delta",
    event_id: "coach",
    delta: "Apa rencanamu besok?",
    start_ms: 0,
    end_ms: 1000,
  });
  await live.action("owner", "repeat");
  live.fromBrowser("owner", {
    type: "session.output_transcript.delta",
    event_id: "repeated",
    delta: " Baik, aku ulangi. Apa rencanamu besok?",
    start_ms: 3000,
    end_ms: 4000,
  });
  await live.action("owner", "slow");
  expect(control.sent.mock.calls.at(-1)![0].content).toContain(
    'COACH utterance: "Apa rencanamu besok?"',
  );
  expect(control.sent.mock.calls.at(-1)![0].content).not.toContain("Baik, aku ulangi");
});
it("times out an unacknowledged control without writing learner speech", async () => {
  control.acknowledge = false;
  await live.start("owner", lessonId, "test-sdp");
  vi.useFakeTimers();
  live.fromBrowser("owner", { type: "session.started", event_id: "started" });
  live.fromBrowser("owner", {
    type: "session.output_transcript.delta",
    event_id: "coach",
    delta: "Halo.",
    start_ms: 0,
    end_ms: 1000,
  });
  const pending = expect(live.action("owner", "repeat")).rejects.toThrow("受付を確認できません");
  await vi.advanceTimersByTimeAsync(12_001);
  await pending;
  expect(store.rows(lessonId)).toHaveLength(1);
});
describe("Live lifecycle", () => {
  it("uses the named Live model, client delegation and disables recordings", async () => {
    await live.start("owner", lessonId, "test-sdp");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.session.model).toBe("gpt-live-1");
    expect(body.session.delegation).toEqual({ type: "client" });
    expect(body.session.store).toBe(false);
    expect(body.session.input[0].role).toBe("developer");
    expect(body.session.audio?.format).toBeUndefined();
  });
  it("rejects a second session without making another paid API request", async () => {
    await live.start("owner", lessonId, "sdp");
    await expect(live.start("other", lessonId, "sdp")).rejects.toThrow("すでに");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("persists both transcript directions and ignores duplicated events", async () => {
    await live.start("owner", lessonId, "sdp");
    const event = {
      type: "session.output_transcript.delta",
      event_id: "caption",
      delta: "Apa kabar?",
      start_ms: 0,
      end_ms: 400,
    };
    live.fromBrowser("owner", event);
    live.fromBrowser("owner", event);
    live.fromBrowser("other", { ...event, event_id: "forged" });
    live.fromBrowser("owner", {
      type: "session.input_transcript.delta",
      event_id: "answer",
      delta: "Baik, でもちょっと busy.",
      start_ms: 200,
      end_ms: 600,
    });
    expect(store.rows(lessonId).map((r) => r.original)).toEqual([
      "Apa kabar?",
      "Baik, でもちょっと busy.",
    ]);
  });
  it("waits for final usage, closes once and does not add snapshots together", async () => {
    await live.start("owner", lessonId, "sdp");
    live.fromBrowser("owner", {
      type: "session.usage.updated",
      event_id: "u1",
      usage: { seconds: 40 },
    });
    live.fromBrowser("owner", {
      type: "session.usage.updated",
      event_id: "u2",
      usage: { seconds: 60 },
    });
    await Promise.all([live.stop(), live.stop()]);
    expect(live.info()).toBeNull();
    expect(store.monthUsage()).toEqual({ seconds: 62, unconfirmed: 0 });
    expect(
      events.filter((e) => e.type === "live" && e.event.type === "session.closed"),
    ).toHaveLength(1);
  });
  it("releases the session lock on a rejected creation and retains its lesson", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 }),
    );
    await expect(live.start("owner", lessonId, "sdp")).rejects.toThrow("401");
    expect(live.info()).toBeNull();
    expect(store.get(lessonId).topic).toBe("仕事");
    expect(store.monthUsage().seconds).toBe(0);
  });
});
