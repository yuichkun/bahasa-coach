// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { SpeechNote } from "./SpeechNote";
import { GlossProvider, clearGlossCache } from "./Gloss";
import type { SpeechFeedback } from "../shared/types";
const note: SpeechFeedback = {
  blockId: "b",
  source: "Aku pergi di kantor.",
  status: "ready",
  result: {
    outcome: "correction",
    original: "di kantor",
    natural: "ke kantor",
    explanation: "行き先には ke を使います。",
    annotations: [
      { term: "ke", meaning: "〜へ（行き先）", formal: "ke", note: "行き先を示します" },
    ],
  },
};
afterEach(() => {
  cleanup();
  clearGlossCache();
  vi.restoreAllMocks();
});
function view(feedback = note, source = note.source, onShown = vi.fn(), onInspect = vi.fn()) {
  return (
    <GlossProvider prefetch={false}>
      <SpeechNote
        lessonId="l"
        source={source}
        feedback={feedback}
        onShown={onShown}
        onInspect={onInspect}
        onOpen={() => {}}
      />
    </GlossProvider>
  );
}
it("shows automatic correction and annotated meaning without requiring an edit or stopping reading", async () => {
  const onShown = vi.fn(),
    onInspect = vi.fn();
  const fetch = vi.spyOn(globalThis, "fetch");
  render(view(note, note.source, onShown, onInspect));
  expect(screen.getByLabelText("この発言の添削")).toBeTruthy();
  expect(screen.queryByText("字幕を修正")).toBeNull();
  expect(onShown).toHaveBeenCalledOnce();
  expect(onInspect).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "ke" })[0]);
  });
  expect(screen.getByText("〜へ（行き先）")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
it("retains a correction through unrelated updates and hides it if its source changes", () => {
  const shown = vi.fn();
  const rendered = render(view(note, note.source, shown));
  rendered.rerender(view(structuredClone(note), note.source, shown));
  expect(shown).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("この発言の添削")).toBeTruthy();
  rendered.rerender(view(note, note.source + " Eh, ke kantor."));
  expect(screen.queryByLabelText("この発言の添削")).toBeNull();
});
it.each(["clear", "uncertain"] as const)("keeps %s checks unobtrusive", (outcome) => {
  render(view({ ...note, result: { ...note.result!, outcome } }));
  expect(screen.queryByLabelText("この発言の添削")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
