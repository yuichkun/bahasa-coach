// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import { Gloss, GlossProvider, clearGlossCache } from "./Gloss";
import { SentenceMeaning } from "./SentenceMeaning";
import { clearTranslationCache, requestTranslation } from "./translation-cache";
import {
  translationKey,
  type TranslationContext,
  type TranslationRequest,
} from "../shared/translation";
const context: TranslationContext = {
  speaker: "assistant",
  before: [{ role: "user", text: "Kapan Dimas datang?" }],
  after: [{ role: "user", text: "Oh, besok ya." }],
};
beforeEach(() => {
  vi.useFakeTimers();
  clearTranslationCache();
  clearGlossCache();
});
afterEach(() => {
  cleanup();
  clearTranslationCache();
  clearGlossCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("prefetches before hover and reuses the full contextual sentence across different words", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const { requests } = JSON.parse(options!.body as string);
    return new Response(
      JSON.stringify({
        entries: requests.map((r: TranslationRequest) => ({
          key: translationKey(r),
          translation: "ディマスは明日来るよ。",
        })),
      }),
    );
  });
  render(
    <GlossProvider>
      <Gloss
        text="Dia datang besok."
        translationContext={context}
        annotations={[
          { term: "Dia", meaning: "彼", formal: "dia", note: "" },
          { term: "datang", meaning: "来る", formal: "datang", note: "" },
          { term: "besok", meaning: "明日", formal: "besok", note: "" },
        ]}
      />
    </GlossProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(fetch.mock.calls[0][1]!.body as string).requests[0];
  expect(sent.before).toEqual(context.before);
  expect(sent.after).toEqual(context.after);
  await act(async () => {
    fireEvent.mouseEnter(screen.getByRole("button", { name: "datang" }));
  });
  expect(screen.getByLabelText("文全体の意味").textContent).toContain("ディマスは明日来るよ。");
  await act(async () => {
    fireEvent.mouseEnter(screen.getByRole("button", { name: "besok" }));
  });
  expect(screen.getByLabelText("文全体の意味").textContent).toContain("ディマスは明日来るよ。");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("never shows a stale translation when another context is selected before a response arrives", async () => {
  let finish!: (r: Response) => void;
  vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementation(async (_url, options) => {
      const { requests } = JSON.parse(options!.body as string);
      return new Response(
        JSON.stringify({
          entries: requests.map((r: TranslationRequest) => ({
            key: translationKey(r),
            translation: "気が引ける。",
          })),
        }),
      );
    });
  const first: TranslationRequest = {
    sentence: "Aku nggak enak.",
    speaker: "assistant",
    before: [{ role: "assistant", text: "Badanku sakit." }],
    after: [],
  };
  const second = {
    ...first,
    before: [{ role: "assistant" as const, text: "Dimas sudah masak, tapi aku mau pulang." }],
  };
  const view = render(<SentenceMeaning request={first} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  view.rerender(<SentenceMeaning request={second} />);
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({ entries: [{ key: translationKey(first), translation: "具合が悪い。" }] }),
      ),
    );
  });
  expect(screen.queryByText("具合が悪い。")).toBeNull();
  expect(screen.getByText("気が引ける。")).toBeTruthy();
});
it("restores a cached sentence without another request after reload", async () => {
  const r: TranslationRequest = { sentence: "Dia datang besok.", ...context };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(
        JSON.stringify({ entries: [{ key: translationKey(r), translation: "明日来るよ。" }] }),
      ),
    );
  const result = requestTranslation(r);
  await vi.advanceTimersByTimeAsync(50);
  await result;
  const saved = localStorage.getItem("bahasa.sentences.v1")!;
  clearTranslationCache();
  localStorage.setItem("bahasa.sentences.v1", saved);
  expect(await requestTranslation(r)).toBe("明日来るよ。");
  expect(fetch).toHaveBeenCalledTimes(1);
});
