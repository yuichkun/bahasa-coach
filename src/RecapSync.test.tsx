// @vitest-environment happy-dom
import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Lesson } from "../shared/types";
import { useRecapSync } from "./useRecapSync";
import { RecapPage } from "./RecapPage";
import { AppErrorBoundary } from "./AppErrorBoundary";

const pending: Lesson = {
  id: "lesson",
  kind: "voice",
  direction: "ja-id",
  topic: "仕事",
  title: "仕事",
  exercise: null,
  draft: "",
  status: "completed",
  createdAt: 1,
  updatedAt: 1,
  rows: [],
  attempts: [],
  recap: {
    status: "pending",
    data: null,
    error: null,
    progress: {
      stage: "generating",
      startedAt: 1,
      updatedAt: 1,
      deadlineAt: 300001,
      attempt: 1,
      receivedChars: 100,
    },
  },
};
function Harness() {
  const [lesson, setLesson] = useState(pending);
  const [error, setError] = useState("");
  useRecapSync({
    id: lesson.id,
    enabled: lesson.recap?.status === "pending" && !error,
    connected: false,
    onLesson: setLesson,
    onError: setError,
  });
  return (
    <RecapPage
      lesson={lesson}
      requestError={error}
      busy={false}
      onRetry={() => {}}
      onTranscript={() => {}}
      onPractice={() => {}}
    />
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("reconciles a saved failure without any WebSocket completion notification", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        ...pending,
        recap: {
          status: "error",
          data: null,
          error: "生成がタイムアウトしました",
          errorId: "test-id",
        },
      }),
    ),
  );
  render(<Harness />);
  expect(await screen.findByText("生成がタイムアウトしました")).toBeTruthy();
  expect(screen.getByRole("button", { name: "まとめを作り直す" })).toBeTruthy();
  expect(document.querySelector(".recap-skeleton")).toBeNull();
});
it("stops the skeleton when the state request hangs and records the timeout", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
  render(<Harness />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_001);
  });
  expect(screen.getByRole("button", { name: "状態を再確認" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("制限時間");
  expect(document.querySelector(".recap-skeleton")).toBeNull();
  expect(log).toHaveBeenCalled();
});
it("does not interpret an invalid successful response as endless generation", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ ...pending, recap: { status: "ready", data: null, error: null } }),
    ),
  );
  render(<Harness />);
  expect(await screen.findByRole("button", { name: "状態を再確認" })).toBeTruthy();
  expect(document.querySelector(".recap-skeleton")).toBeNull();
});
it("continues checking until a successful result is saved and then stops polling", async () => {
  vi.useFakeTimers();
  const completed = {
    ...pending,
    recap: {
      status: "ready",
      error: null,
      data: {
        title: "完成したノート",
        introduction: "内容",
        sections: [],
        next: { title: "次", prompt: "話す", reason: "練習" },
        closing: "また次回",
      },
    },
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify(pending)))
    .mockResolvedValueOnce(new Response(JSON.stringify(completed)));
  render(<Harness />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(screen.getByRole("heading", { name: "完成したノート" })).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("stops the UI at an error boundary and logs an unexpected rendering failure", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): never {
    throw new TypeError("render exploded");
  }
  render(
    <AppErrorBoundary>
      <Broken />
    </AppErrorBoundary>,
  );
  expect(screen.getByRole("alert").textContent).toContain("render exploded");
  expect(screen.getByRole("button", { name: "アプリを再読み込み" })).toBeTruthy();
  expect(log).toHaveBeenCalled();
});
