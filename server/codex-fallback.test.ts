import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { CodexBackend } from "./codex.ts";
import type { AvailableModel } from "./model-policy.ts";
const models: AvailableModel[] = [
  { model: "gpt-5.6-sol", isDefault: true, defaultReasoningEffort: "low" },
  { model: "gpt-5.3-codex-spark", defaultReasoningEffort: "low" },
  { model: "gpt-5.6-luna", defaultReasoningEffort: "low" },
  { model: "unrelated-model", defaultReasoningEffort: "low" },
];
afterEach(() => vi.restoreAllMocks());
function setup(failing: Set<string>, info = "usageLimitExceeded") {
  const backend = new CodexBackend("/unused-test-path");
  const internal = backend as unknown as {
    start(): Promise<void>;
    rpc(method: string, params: Record<string, unknown>): Promise<unknown>;
    events: EventEmitter;
  };
  vi.spyOn(internal, "start").mockResolvedValue();
  vi.spyOn(backend, "availableModels").mockResolvedValue(models);
  vi.spyOn(backend, "status").mockResolvedValue({
    connected: true,
    email: null,
    plan: "pro",
    pending: false,
    error: null,
  });
  const selected: string[] = [];
  vi.spyOn(internal, "rpc").mockImplementation(async (method, params) => {
    if (method === "thread/start") {
      selected.push(params.model as string);
      return { thread: { id: `thread-${selected.length}` } };
    }
    if (method === "turn/start") {
      queueMicrotask(() =>
        internal.events.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: params.threadId,
            turn: failing.has(params.model as string)
              ? {
                  status: "failed",
                  error: { message: "provider rejected this model", codexErrorInfo: info },
                }
              : {
                  status: "completed",
                  items: [
                    { type: "agentMessage", text: JSON.stringify({ translation: "訳できました" }) },
                  ],
                },
          },
        }),
      );
      return { turn: { id: "turn" } };
    }
    return {};
  });
  return { backend, selected };
}
it("switches exhausted fast models within the subscription and remembers their cooldown", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const failing = new Set(["gpt-5.3-codex-spark"]);
  const { backend, selected } = setup(failing);
  expect(
    await backend.requestJson("Translate", {}, { translation: true, translationPrecision: "fast" }),
  ).toEqual({ translation: "訳できました" });
  await backend.requestJson("Prepare words", {}, { prefetch: true });
  expect(selected).toEqual(["gpt-5.3-codex-spark", "gpt-5.6-luna", "gpt-5.6-luna"]);
  failing.clear();
  now += 16 * 60_000;
  await backend.requestJson("Translate again", {}, { translation: true });
  expect(selected.at(-1)).toBe("gpt-5.3-codex-spark");
});
it("does not change models on unrelated authentication or provider errors", async () => {
  const { backend, selected } = setup(new Set(["gpt-5.3-codex-spark"]), "unauthorized");
  await expect(backend.requestJson("Translate", {}, { translation: true })).rejects.toThrow(
    "provider rejected",
  );
  expect(selected).toEqual(["gpt-5.3-codex-spark"]);
});
it("stops cycling after all eligible models are exhausted and waits before trying again", async () => {
  const { backend, selected } = setup(new Set(models.map((model) => model.model)));
  await expect(backend.requestJson("Translate", {}, { translation: true })).rejects.toThrow(
    "自動で再試行",
  );
  expect(selected).toEqual(["gpt-5.3-codex-spark", "gpt-5.6-luna", "gpt-5.6-sol"]);
  await expect(backend.requestJson("Translate again", {}, { translation: true })).rejects.toThrow(
    "自動で再試行",
  );
  expect(selected).toHaveLength(3);
});
