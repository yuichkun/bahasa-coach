// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
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
function learnerSpeaking(text: string, endMs: number): Lesson {
  const current = lesson();
  current.rows.push({
    id: "u",
    role: "user",
    original: text,
    corrected: null,
    revisionStale: false,
    startMs: 1500,
    endMs,
  });
  return current;
}
function hintsView(current: Lesson) {
  return (
    <GlossProvider prefetch={false}>
      <ReplyHints lesson={current} onInspect={() => {}} />
    </GlossProvider>
  );
}
function initialHints() {
  return new Response(
    JSON.stringify({
      source: "Apa kabar?",
      hints: [
        { text: "Baik, makasih.", intent: "元気と伝える" },
        { text: "Agak capek.", intent: "少し疲れている" },
        { text: "Kamu gimana?", intent: "相手にも聞く" },
      ],
    }),
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("keeps the same hints throughout learner transcription without requesting them again", async () => {
  vi.useFakeTimers();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => initialHints());
  const view = render(hintsView(lesson()));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(950);
  });
  const displayed = screen.getAllByRole("listitem");
  expect(displayed).toHaveLength(3);

  for (const [text, endMs] of [
    ["Ba", 1700],
    ["Baik, maka", 2100],
    ["Baik, makasih.", 2800],
  ] as const) {
    view.rerender(hintsView(learnerSpeaking(text, endMs)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getAllByRole("listitem")).toEqual(displayed);
    expect(screen.getByText("元気と伝える")).toBeTruthy();
  }
  expect(fetch).toHaveBeenCalledTimes(1);

  fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          source: "Mau makan apa?",
          hints: [{ text: "Nasi goreng.", intent: "炒飯を頼む" }],
        }),
      ),
  );
  view.rerender(hintsView(lesson(true)));
  expect(screen.queryByText("元気と伝える")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(950);
  });
  expect(screen.getByText("炒飯を頼む")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([0, 950])(
  "delivers hints even if learner transcription starts after %i ms",
  async (delay) => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(hintsView(lesson()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(delay);
    });
    view.rerender(hintsView(learnerSpeaking("Baik", 2000)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(950);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(initialHints());
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("元気と伝える")).toBeTruthy();
  },
);

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
    <GlossProvider prefetch={false}>
      <ReplyHints lesson={lesson()} onInspect={() => {}} />
    </GlossProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(950);
  });
  view.rerender(
    <GlossProvider prefetch={false}>
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
