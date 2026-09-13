// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { LanguageContext } from "./LanguageContext";
import { Gloss, GlossProvider } from "./Gloss";
import { clearGlossCache, ingestGlossary, peekMeaning, warmGlossarySource } from "./glossary-cache";
import { CaptionText } from "./CaptionText";
import { clearTranslationCache } from "./translation-cache";
import { translationKey } from "../shared/translation";

afterEach(() => {
  cleanup();
  clearGlossCache();
  clearTranslationCache();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("shows contextual pinyin and opens a ready Chinese definition without a hover request", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const inspect = vi.fn();
  const view = render(
    <GlossProvider prefetch={false}>
      <LanguageContext.Provider value={{ language: "zh-Hans", pinyin: true }}>
        <Gloss
          text="去银行。"
          annotations={[{ term: "银行", meaning: "銀行", formal: "", note: "" }]}
          onInspect={inspect}
        />
      </LanguageContext.Provider>
    </GlossProvider>,
  );
  await waitFor(() => expect(view.container.querySelectorAll("rt").length).toBeGreaterThan(0));
  expect(screen.getByText("yín háng")).toBeTruthy();
  expect(inspect).toHaveBeenCalled();
  await act(async () => fireEvent.mouseEnter(screen.getByRole("button", { name: "银行" })));
  expect(screen.getByRole("dialog", { name: "银行の意味" })).toBeTruthy();
  expect(screen.getByText("銀行")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves source text when pinyin is disabled and does not romanize Japanese explanations", () => {
  const view = render(
    <LanguageContext.Provider value={{ language: "zh-Hans", pinyin: false }}>
      <Gloss text="我喜欢中文。🙂" />
    </LanguageContext.Provider>,
  );
  expect(view.container.textContent).toBe("我喜欢中文。🙂");
  expect(view.container.querySelector("rt")).toBeNull();
  view.rerender(
    <LanguageContext.Provider value={{ language: "zh-Hans", pinyin: true }}>
      <Gloss japanese text="銀行。昨日は仕事でした。" />
    </LanguageContext.Provider>,
  );
  expect(view.container.querySelector("rt")).toBeNull();
  expect(view.container.textContent).toBe("銀行。昨日は仕事でした。");
});

it("retains language-separated dictionary caches after browser storage reload", async () => {
  vi.useFakeTimers();
  const value = { term: "air", formal: "", note: "" };
  ingestGlossary({ language: "id", entries: [], vocabulary: [{ ...value, meaning: "水" }] });
  ingestGlossary({ language: "en", entries: [], vocabulary: [{ ...value, meaning: "空気" }] });
  await vi.advanceTimersByTimeAsync(250);
  clearGlossCache(true);
  expect(peekMeaning("air", "air", "id")?.meaning).toBe("水");
  expect(peekMeaning("air", "air", "en")?.meaning).toBe("空気");
  expect(peekMeaning("air", "air", "zh-Hans")).toBeNull();
});

it("prefetches Chinese definitions with an explicit language and consumes its results", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const body = JSON.parse(options?.body as string);
    expect(body.language).toBe("zh-Hans");
    return new Response(
      JSON.stringify({
        language: body.language,
        entries: body.requests.map((r: { term: string; context: string }) => ({
          ...r,
          annotation: { term: r.term, meaning: "意味", formal: "", note: "" },
        })),
        vocabulary: [],
      }),
    );
  });
  const stop = warmGlossarySource("chinese", "今天去银行。", false, "zh-Hans");
  await waitFor(() => expect(peekMeaning("银行", "今天去银行。", "zh-Hans")?.meaning).toBe("意味"));
  expect(fetch).toHaveBeenCalled();
  expect(peekMeaning("银行", "今天去银行。", "id")).toBeNull();
  stop();
});

it("translates a Han-only caption and retains the original with pinyin", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const { requests } = JSON.parse(options?.body as string);
    expect(requests[0].language).toBe("zh-Hans");
    expect(requests[0].sentence).toBe("我想学习中文。");
    return new Response(
      JSON.stringify({
        entries: requests.map((r: Parameters<typeof translationKey>[0]) => ({
          key: translationKey(r),
          translation: "中国語を勉強したいです。",
        })),
      }),
    );
  });
  const view = render(
    <LanguageContext.Provider value={{ language: "zh-Hans", pinyin: true }}>
      <CaptionText
        text="我想学习中文。"
        context={{ speaker: "user", before: [], after: [] }}
        streaming={false}
        prefetch={false}
        onOpen={() => {}}
        onInspect={() => {}}
      />
    </LanguageContext.Provider>,
  );
  await waitFor(() => expect(screen.getByText("中国語を勉強したいです。")).toBeTruthy());
  await waitFor(() => expect(view.container.querySelectorAll("rt").length).toBeGreaterThan(0));
});

it("closes an old popup when the same Latin spelling changes learning language", async () => {
  const renderWord = (language: "id" | "en") => (
    <GlossProvider prefetch={false}>
      <LanguageContext.Provider value={{ language, pinyin: false }}>
        <Gloss
          text="air"
          annotations={[
            { term: "air", meaning: language === "id" ? "水" : "空気", formal: "", note: "" },
          ]}
        />
      </LanguageContext.Provider>
    </GlossProvider>
  );
  const view = render(renderWord("id"));
  fireEvent.click(screen.getByRole("button", { name: "air" }));
  expect(screen.getByText("水")).toBeTruthy();
  view.rerender(renderWord("en"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "air" }));
  expect(screen.getByText("空気")).toBeTruthy();
});
