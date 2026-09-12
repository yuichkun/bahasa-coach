// @vitest-environment happy-dom
import React, { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import App from "./App";
import { GlossProvider } from "./Gloss";
import type { Lesson } from "../shared/types";
const mocks = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn(),
  sockets: [] as any[],
}));
vi.mock("./voice", () => ({
  VoiceClient: class {
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
  mocks.start.mockClear();
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
it("does not automatically generate generic feedback when free conversation ends", async () => {
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
  expect(screen.getByRole("button", { name: "この練習から、表現を１つ見直す" })).toBeTruthy();
});
