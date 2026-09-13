import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Store } from "./store.ts";
import { Tutor } from "./tutor.ts";
import { FakeBackend } from "./fixtures.test-helper.ts";
import type { AppEvent } from "../shared/types.ts";
const control = vi.hoisted(() => ({ sent: vi.fn(), closeAcknowledged: true }));

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
      if (e.type === "session.close" && control.closeAcknowledged)
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
  control.closeAcknowledged = true;
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
  tutor.recap.close();
  tutor.speech.close();
  await live.stop();
  store.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

it("closes for a thinking break, preserves the lesson and resumes with context and separate billing", async () => {
  const ensure = vi.spyOn(tutor.recap, "ensure");
  await live.start("owner", lessonId, "sdp");
  live.fromBrowser("owner", { type: "session.started", event_id: "started" });
  live.fromBrowser("owner", {
    type: "session.input_transcript.delta",
    event_id: "user",
    delta: "Aku lagi kerja.",
    start_ms: 0,
    end_ms: 900,
  });
  live.fromBrowser("owner", {
    type: "session.output_transcript.delta",
    event_id: "coach",
    delta: "Kerja apa?",
    start_ms: 1100,
    end_ms: 1800,
  });
  const before = store.rows(lessonId);
  await live.pause("owner");
  expect(live.info()).toBeNull();
  expect(store.get(lessonId).status).toBe("paused");
  expect(store.rows(lessonId)).toEqual(before);
  expect(store.lessonUsage(lessonId)).toBe(62);
  expect(ensure).not.toHaveBeenCalled();
  expect(
    events.some(
      (e) => e.type === "live" && e.event.type === "session.closed" && e.event.paused === true,
    ),
  ).toBe(true);
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ session: { id: "live_resumed" }, transport: { sdp: "answer" } }),
      { status: 201 },
    ),
  );
  await live.start("owner", lessonId, "sdp2");
  const request = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body));
  expect(
    request.session.input.some(
      (m: any) => m.role === "user" && m.content[0].text === "Aku lagi kerja.",
    ),
  ).toBe(true);
  expect(
    request.session.input.some(
      (m: any) => m.role === "assistant" && m.content[0].text === "Kerja apa?",
    ),
  ).toBe(true);
  live.fromBrowser("owner", {
    type: "session.input_transcript.delta",
    event_id: "user",
    delta: "Aku bikin aplikasi.",
    start_ms: 0,
    end_ms: 700,
  });
  expect(store.rows(lessonId).at(-1)!.startMs).toBeGreaterThan(1800);
  expect(store.rows(lessonId).at(-1)!.original).toBe("Aku bikin aplikasi.");
  expect(live.info()?.seconds).toBe(77);
  await live.stop();
  expect(store.lessonUsage(lessonId)).toBe(124);
  expect(store.monthUsage().seconds).toBe(124);
  expect(ensure).toHaveBeenCalledOnce();
});
it("does not report a free thinking break when the provider cannot confirm closure", async () => {
  await live.start("owner", lessonId, "sdp");
  live.fromBrowser("owner", { type: "session.started", event_id: "started" });
  vi.useFakeTimers();
  control.closeAcknowledged = false;
  fetchMock.mockRejectedValueOnce(new Error("network unavailable"));
  const failure = expect(live.pause("owner")).rejects.toThrow("network unavailable");
  await vi.advanceTimersByTimeAsync(6100);
  await failure;
  expect(store.get(lessonId).status).toBe("active");
  expect(live.info()).not.toBeNull();
  control.closeAcknowledged = true;
});
it("keeps a paused lesson recoverable if reconnecting fails", async () => {
  await live.start("owner", lessonId, "sdp");
  live.fromBrowser("owner", { type: "session.started", event_id: "started" });
  await live.pause("owner");
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  await expect(live.start("owner", lessonId, "sdp2")).rejects.toThrow("offline");
  expect(store.get(lessonId).status).toBe("paused");
  expect(store.lessonUsage(lessonId)).toBe(62);
});

it.each(["zh-Hans", "en"] as const)(
  "uses the %s persona for a voice session and its reconnection",
  async (language) => {
    const direction = language === "en" ? "ja-en" : "ja-zh";
    const lesson = store.create("voice", direction, "自由会話");
    await live.start("owner", lesson.id, "offer-sdp");
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first.session.instructions).toContain(language === "en" ? "Alex" : "林悦");
    expect(first.session.instructions).not.toContain("Kamu memerankan Rani");
    live.fromBrowser("owner", { type: "session.started", event_id: "started" });
    await live.pause("owner");
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ session: { id: "live_language_resumed" }, transport: { sdp: "answer" } }),
        { status: 201 },
      ),
    );
    await live.start("owner", lesson.id, "offer-sdp");
    const next = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(next.session.instructions).toBe(first.session.instructions);
    expect(next.session.input[0].content[0].text).toContain("Continue the saved conversation");
    expect(store.get(lesson.id).language).toBe(language);
  },
);
