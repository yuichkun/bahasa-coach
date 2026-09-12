import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Store } from "./store.ts";
import { Tutor } from "./tutor.ts";
import { FakeBackend } from "./fixtures.test-helper.ts";
import type { AppEvent } from "../shared/types.ts";

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
  live: LiveManager,
  lessonId: string,
  events: AppEvent[],
  fetchMock: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  store = new Store(":memory:");
  lessonId = store.create("voice", "ja-id", "仕事").id;
  events = [];
  live = new LiveManager(
    store,
    new Tutor(new FakeBackend(), store),
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
  await live.stop();
  store.close();
  vi.restoreAllMocks();
});
describe("Live lifecycle", () => {
  it("uses the named Live model, client delegation and disables recordings", async () => {
    await live.start("owner", lessonId, "test-sdp");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.session.model).toBe("gpt-live-1");
    expect(body.session.delegation).toEqual({ type: "client" });
    expect(body.session.store).toBe(false);
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
