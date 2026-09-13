// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { RecapPage } from "./RecapPage";
import { GlossProvider, clearGlossCache } from "./Gloss";
import type { Lesson } from "../shared/types";
const lesson: Lesson = {
  id: "lesson",
  kind: "voice",
  direction: "ja-id",
  title: "仕事",
  topic: "仕事",
  exercise: null,
  draft: "",
  status: "completed",
  createdAt: 1,
  updatedAt: 1,
  attempts: [],
  rows: [
    {
      id: "u",
      role: "user",
      original: "Aku pergi di kantor.",
      corrected: null,
      revisionStale: false,
      startMs: 0,
      endMs: 1000,
    },
  ],
  recap: {
    status: "ready",
    error: null,
    data: {
      title: "仕事の予定を伝える",
      introduction: "会話で使った表現を見ていきましょう。",
      sections: [
        {
          title: "行き先の表し方",
          summary: "職場へ向かう予定を話しました。",
          sourceIds: ["u"],
          points: [
            {
              kind: "adjust",
              title: "行き先には ke",
              sourceId: "u",
              quote: "Aku pergi di kantor.",
              natural: "Aku pergi ke kantor.",
              originalFocus: "di",
              focus: "ke",
              explanation: "di は場所、ke は行き先を表します。",
              examples: [{ text: "Besok aku pergi ke kantor.", meaning: "明日は職場へ行きます。" }],
              annotations: [{ term: "kantor", meaning: "職場", formal: "kantor", note: "" }],
            },
          ],
        },
      ],
      next: {
        title: "次は明日の予定を",
        prompt: "行き先も添えてみましょう。",
        reason: "今日の表現を使えます。",
      },
      closing: "少しずつ使っていきましょう。",
    },
  },
};
afterEach(() => {
  cleanup();
  clearGlossCache();
  vi.restoreAllMocks();
});
it("presents source, highlighted natural expression, explanation and examples together", async () => {
  const practice = vi.fn();
  const fetch = vi.spyOn(globalThis, "fetch");
  const view = render(
    <GlossProvider prefetch={false}>
      <RecapPage
        lesson={lesson}
        busy={false}
        onRetry={() => {}}
        onTranscript={() => {}}
        onPractice={practice}
      />
    </GlossProvider>,
  );
  expect(screen.getByRole("heading", { name: "仕事の予定を伝える" })).toBeTruthy();
  expect(view.container.querySelector(".recap-natural mark")?.textContent).toBe("ke");
  expect(screen.getByText("明日は職場へ行きます。")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "kantor" })[1]);
  });
  expect(screen.getByText("職場")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "この表現を、書いて使ってみる" }));
  expect(practice).toHaveBeenCalledWith(0, 0);
});
it("keeps whole-word dictionary targets and sentence context when a highlight crosses a word", () => {
  const value = structuredClone(lesson);
  value.recap!.data!.sections[0].points[0].focus = "kan";
  render(
    <GlossProvider prefetch={false}>
      <RecapPage
        lesson={value}
        busy={false}
        onRetry={() => {}}
        onTranscript={() => {}}
        onPractice={() => {}}
      />
    </GlossProvider>,
  );
  expect(screen.getAllByRole("button", { name: "kantor" })).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "kan" })).toBeNull();
});
it("offers retry for a failed direct page request instead of an endless loading state", () => {
  const retry = vi.fn();
  render(
    <RecapPage
      lesson={null}
      requestError="接続できませんでした"
      busy={false}
      onRetry={retry}
      onTranscript={() => {}}
      onPractice={() => {}}
    />,
  );
  expect(screen.getByText("接続できませんでした")).toBeTruthy();
  expect(screen.queryByText("会話全体から、学びを整理しています")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "まとめを作り直す" }));
  expect(retry).toHaveBeenCalledOnce();
});
