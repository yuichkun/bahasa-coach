import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { CodexBackend } from "./codex.ts";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup() {
  const backend = new CodexBackend("/unused-test-path");
  const internal = backend as unknown as {
    start(): Promise<void>;
    rpc(method: string, params: Record<string, unknown>): Promise<unknown>;
    events: EventEmitter;
  };
  vi.spyOn(internal, "start").mockResolvedValue();
  vi.spyOn(backend, "status").mockResolvedValue({
    connected: true,
    email: null,
    plan: "pro",
    pending: false,
    error: null,
  });
  vi.spyOn(backend, "availableModels").mockResolvedValue([
    { model: "test-model", isDefault: true, defaultReasoningEffort: "low" },
  ]);
  let threads = 0;
  const rpc = vi.spyOn(internal, "rpc").mockImplementation(async (method) => {
    if (method === "thread/start") return { thread: { id: `thread-${++threads}` } };
    if (method === "turn/start") return { turn: { id: "turn" } };
    return {};
  });
  const finish = (threadId: string) =>
    internal.events.emit("notification", {
      method: "turn/completed",
      params: {
        threadId,
        turn: { status: "completed", items: [{ type: "agentMessage", text: '{"ok":true}' }] },
      },
    });
  return { backend, internal, rpc, finish };
}
it("rejects provider error notifications immediately without waiting for turn/completed", async () => {
  const { backend, internal, rpc } = setup();
  const progress = vi.fn();
  const failure = expect(
    backend.requestJson("recap", {}, { recap: true, onProgress: progress }),
  ).rejects.toThrow("provider failed");
  await vi.waitFor(() => expect(rpc.mock.calls.some(([m]) => m === "turn/start")).toBe(true));
  internal.events.emit("notification", {
    method: "item/agentMessage/delta",
    params: { threadId: "thread-1", delta: "abc" },
  });
  expect(progress).toHaveBeenLastCalledWith({ stage: "generating", receivedChars: 3 });
  internal.events.emit("notification", {
    method: "error",
    params: { threadId: "thread-1", error: { message: "provider failed" } },
  });
  await failure;
  expect(rpc.mock.calls.some(([m]) => m === "turn/interrupt")).toBe(true);
  expect(internal.events.listenerCount("notification")).toBe(0);
});
it("cancels a queued request immediately without running it or overtaking the active request", async () => {
  const { backend, rpc, finish } = setup();
  const first = backend.requestJson("first", {}, { recap: true });
  await vi.waitFor(() => expect(rpc.mock.calls.some(([m]) => m === "turn/start")).toBe(true));
  const controller = new AbortController();
  const cancelled = expect(
    backend.requestJson("cancelled", {}, { recap: true, signal: controller.signal }),
  ).rejects.toThrow("deadline");
  controller.abort(new Error("deadline"));
  await cancelled;
  const third = backend.requestJson("third", {}, { recap: true });
  await Promise.resolve();
  expect(rpc.mock.calls.filter(([m]) => m === "thread/start")).toHaveLength(1);
  finish("thread-1");
  await first;
  await vi.waitFor(() =>
    expect(rpc.mock.calls.filter(([m]) => m === "turn/start")).toHaveLength(2),
  );
  const prompts = rpc.mock.calls.filter(([m]) => m === "turn/start").map(([, p]) => p.input);
  expect(JSON.stringify(prompts)).not.toContain("cancelled");
  finish("thread-2");
  await third;
});
it("interrupts an active turn on cancellation and ignores late completion", async () => {
  const { backend, rpc, internal, finish } = setup();
  const controller = new AbortController();
  const failure = expect(
    backend.requestJson("recap", {}, { recap: true, signal: controller.signal }),
  ).rejects.toThrow("deadline");
  await vi.waitFor(() => expect(rpc.mock.calls.some(([m]) => m === "turn/start")).toBe(true));
  controller.abort(new Error("deadline"));
  await failure;
  expect(rpc.mock.calls.filter(([m]) => m === "turn/interrupt")).toHaveLength(1);
  finish("thread-1");
  expect(internal.events.listenerCount("notification")).toBe(0);
});
