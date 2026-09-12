// @vitest-environment happy-dom
import React, { act } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ReplyHints } from "./ReplyHints";
import { GlossProvider } from "./Gloss";
import type { Lesson } from "../shared/types";
function lesson(second = false): Lesson {
  return {
    id: "hints-test",
    kind: "voice",
    direction: "ja-id",
    topic: "自由会話",
    title: "",
    exercise: null,
    draft: "",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    attempts: [],
    rows: [
      {
        id: "a",
        role: "assistant",
        original: "Apa kabar?",
        corrected: null,
        revisionStale: false,
        startMs: 0,
        endMs: 1000,
      },
      ...(second
        ? [
            {
              id: "u",
              role: "user" as const,
              original: "Baik.",
              corrected: null,
              revisionStale: false,
              startMs: 1500,
              endMs: 2000,
            },
            {
              id: "b",
              role: "assistant" as const,
              original: "Mau makan apa?",
              corrected: null,
              revisionStale: false,
              startMs: 2500,
              endMs: 3500,
            },
          ]
        : []),
    ],
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("drops stale reply hints and shows three examples only for the current utterance", async () => {
  vi.useFakeTimers();
  let finish!: (r: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const { source } = JSON.parse(typeof init?.body === "string" ? init?.body : "");
    if (source === "Apa kabar?")
      return new Promise((resolve) => {
        finish = resolve;
      });
    return new Response(
      JSON.stringify({
        source,
        hints: [
          { text: "Nasi goreng.", intent: "炒飯" },
          { text: "Belum tahu.", intent: "未定" },
          { text: "Kamu mau apa?", intent: "相手に聞く" },
        ],
      }),
    );
  });
  const view = render(
    <GlossProvider>
      <ReplyHints lesson={lesson()} onInspect={() => {}} />
    </GlossProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(950);
  });
  view.rerender(
    <GlossProvider>
      <ReplyHints lesson={lesson(true)} onInspect={() => {}} />
    </GlossProvider>,
  );
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({
          source: "Apa kabar?",
          hints: [{ text: "OLD ANSWER", intent: "古い候補" }],
        }),
      ),
    );
  });
  expect(screen.queryByText("古い候補")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(950);
  });
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByText("炒飯")).toBeTruthy();
  expect(screen.queryByText("古い候補")).toBeNull();
});
