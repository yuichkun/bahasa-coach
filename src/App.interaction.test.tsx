// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import App from "./App";
import { GlossProvider } from "./Gloss";
import type { Lesson } from "../shared/types";
const mocks = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn(),
  owner: "",
  sockets: [] as any[],
}));
vi.mock("./voice", () => ({
  VoiceClient: class {
    constructor(owner: string) {
      mocks.owner = owner;
    }
    start = mocks.start;
    cleanup = mocks.cleanup;
    stop = vi.fn().mockResolvedValue(undefined);
    mute = vi.fn();
  },
}));
const free: Lesson = {
  id: "free-test",
  kind: "voice",
  direction: "ja-id",
  topic: "自由会話",
  title: "自由会話",
  exercise: null,
  draft: "",
  status: "draft",
  createdAt: 1,
  updatedAt: 1,
  rows: [],
  attempts: [],
};
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  mocks.start.mockReset().mockResolvedValue(undefined);
  mocks.sockets = [];
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      onopen: any;
      onmessage: any;
      onclose: any;
      onerror: any;
      constructor() {
        mocks.sockets.push(this);
        queueMicrotask(() => this.onopen?.());
      }
      send() {}
      close() {
        this.onclose?.();
      }
    },
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    if (
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith("/status")
    )
      return new Response(
        JSON.stringify({
          chatgpt: { connected: true, email: null, plan: "pro", pending: false, error: null },
          voice: {
            configured: true,
            active: null,
            monthSeconds: 0,
            unconfirmed: 0,
            pricePerMinute: 0.05,
          },
        }),
      );
    if (
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith(
        "/lessons",
      ) &&
      options?.method === "POST"
    )
      return new Response(JSON.stringify(free));
    if (
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes("/recap")
    )
      return new Response(
        JSON.stringify({
          ...free,
          status: "completed",
          recap: { status: "pending", data: null, error: null },
        }),
      );
    return new Response(JSON.stringify([]));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("starts a free conversation with one click, without generating an exercise", async () => {
  const { container } = render(
    <GlossProvider>
      <App />
    </GlossProvider>,
  );
  const start = screen.getByRole("button", { name: "話す" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  expect(container.querySelector(".sidebar")).toBeNull();
  expect((container.querySelector(".optional-practice") as HTMLDetailsElement).open).toBe(false);
  fireEvent.click(start);
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  expect(mocks.start.mock.calls[0][0]).toBe("free-test");
  const calls = vi.mocked(fetch).mock.calls;
  expect(
    calls.some(([url]) =>
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
        "/exercise",
      ),
    ),
  ).toBe(false);
  const create = calls.find(
    ([url, init]) =>
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith(
        "/lessons",
      ) && init?.method === "POST",
  );
  expect(JSON.parse(typeof create?.[1]?.body === "string" ? create?.[1]?.body : "").topic).toBe(
    "自由会話",
  );
});
it("automatically opens the dedicated recap page when free conversation ends", async () => {
  render(
    <GlossProvider>
      <App />
    </GlossProvider>,
  );
  const start = screen.getByRole("button", { name: "話す" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  await act(async () => {
    const socket = mocks.sockets[0];
    socket.onmessage({
      data: JSON.stringify({
        type: "lesson",
        lesson: {
          ...free,
          status: "completed",
          rows: [
            {
              id: "u",
              role: "user",
              original: "Aku setuju.",
              corrected: null,
              revisionStale: false,
              startMs: 0,
              endMs: 1000,
            },
          ],
        },
      }),
    });
    socket.onmessage({
      data: JSON.stringify({
        type: "live",
        lessonId: free.id,
        event: { type: "session.closed", usage: { seconds: 5 } },
      }),
    });
  });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) =>
        (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
          "/evaluate",
        ),
      ),
  ).toBe(false);
  expect(screen.getByRole("heading", { name: "今日のレッスンノート" })).toBeTruthy();
  expect(location.hash).toBe("#/recap/free-test");
  expect(screen.queryByRole("log", { name: "会話の字幕" })).toBeNull();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) =>
        (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith(
          "/recap",
        ),
      ),
  ).toBe(true);
});

it("keeps reply hints mounted while reconnecting the same paused lesson", async () => {
  const paused: Lesson = {
    ...free,
    status: "paused",
    rows: [
      {
        id: "coach",
        role: "assistant",
        original: "Mau makan apa?",
        corrected: null,
        revisionStale: false,
        startMs: 0,
        endMs: 1000,
      },
    ],
  };
  localStorage.setItem("bahasa.voice", paused.id);
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (typeof url === "string" && url.endsWith("/lessons") && options?.method !== "POST")
      return new Response(JSON.stringify([paused]));
    if (typeof url === "string" && url.endsWith("/reply-hints"))
      return new Response(
        JSON.stringify({
          source: "Mau makan apa?",
          hints: [{ text: "Nasi goreng.", intent: "炒飯を選ぶ" }],
        }),
      );
    return originalFetch(url, options);
  });
  let finish!: () => void;
  mocks.start.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <GlossProvider prefetch={false}>
      <App />
    </GlossProvider>,
  );
  await waitFor(() => expect(screen.getByText("炒飯を選ぶ")).toBeTruthy(), { timeout: 2500 });
  const shown = screen.getByText("炒飯を選ぶ");
  fireEvent.click(screen.getByRole("button", { name: "続きから話す" }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  expect(screen.getByText("炒飯を選ぶ")).toBe(shown);
  await act(async () => {
    finish();
  });
  expect(screen.getByText("炒飯を選ぶ")).toBe(shown);
});
it("prevents an older recap route from replacing the current active lesson", async () => {
  render(
    <GlossProvider prefetch={false}>
      <App />
    </GlossProvider>,
  );
  const start = screen.getByRole("button", { name: "話す" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  await act(async () => {
    window.history.pushState(null, "", "#/recap/older-lesson");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(location.hash).toBe("#/voice");
  expect(screen.getByText("会話を終了してから、レッスンノートを開いてください。")).toBeTruthy();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => typeof url === "string" && url.includes("older-lesson")),
  ).toBe(false);
});
