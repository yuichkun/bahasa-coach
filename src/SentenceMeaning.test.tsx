// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import { GlossProvider, clearGlossCache } from "./Gloss";
import { CaptionText } from "./CaptionText";
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
it("shows each sentence translation directly below its original without hover", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const { requests } = JSON.parse(options!.body as string);
    return new Response(
      JSON.stringify({
        entries: requests.map((r: TranslationRequest) => ({
          key: translationKey(r),
          translation:
            r.sentence === "Dia datang besok." ? "ディマスは明日来るよ。" : "一緒に来る？",
        })),
      }),
    );
  });
  const onInspect = vi.fn();
  const view = render(
    <GlossProvider prefetch={false}>
      <CaptionText
        text="Dia datang besok. Kamu ikut?"
        context={context}
        streaming={false}
        prefetch={false}
        onOpen={() => {}}
        onInspect={onInspect}
      />
    </GlossProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  const rows = view.container.querySelectorAll(".caption-sentence");
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector(".caption-text")?.textContent?.trim()).toBe("Dia datang besok.");
  expect(rows[0].querySelector(".caption-text")?.nextElementSibling?.textContent).toBe(
    "ディマスは明日来るよ。",
  );
  expect(rows[1].querySelector(".caption-translation")?.textContent).toBe("一緒に来る？");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onInspect).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(fetch.mock.calls[0][1]!.body as string).requests;
  expect(sent[0].before).toEqual(context.before);
  expect(sent[0].after.map((t: { text: string }) => t.text)).toEqual([
    "Kamu ikut?",
    "Oh, besok ya.",
  ]);
  expect(sent[1].before.at(-1).text).toBe("Dia datang besok.");
  await act(async () => {
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Dia" }));
  });
  const popup = screen.getByRole("dialog");
  expect(popup.textContent).toContain("彼・彼女");
  expect(popup.querySelector(".caption-translation")).toBeNull();
  expect(popup.textContent).not.toContain("ディマスは明日来るよ。");
  expect(screen.getByText("ディマスは明日来るよ。")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("debounces growing live captions and keeps a visible translation while following context updates", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const { requests } = JSON.parse(options!.body as string);
    return new Response(
      JSON.stringify({
        entries: requests.map((r: TranslationRequest) => ({
          key: translationKey(r),
          translation: "明日来るよ。",
        })),
      }),
    );
  });
  const caption = (text: string, ctx = context) => (
    <GlossProvider prefetch={false}>
      <CaptionText
        text={text}
        context={ctx}
        streaming
        prefetch={false}
        onOpen={() => {}}
        onInspect={() => {}}
      />
    </GlossProvider>
  );
  const view = render(caption("Dia datang"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  view.rerender(caption("Dia datang besok."));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(screen.getByText("明日来るよ。")).toBeTruthy();
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).requests[0].sentence).toBe(
    "Dia datang besok.",
  );
  view.rerender(
    caption("Dia datang besok.", {
      ...context,
      after: [{ role: "user", text: "Oh, besok ya. Oke." }],
    }),
  );
  expect(screen.getByText("明日来るよ。")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves untranslated Japanese between Indonesian sentences", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const { requests } = JSON.parse(options!.body as string);
    return new Response(
      JSON.stringify({
        entries: requests.map((r: TranslationRequest) => ({
          key: translationKey(r),
          translation: "明日来るよ。",
        })),
      }),
    );
  });
  const view = render(
    <GlossProvider prefetch={false}>
      <CaptionText
        text="なるほど。Dia datang besok. そうなんですね。"
        context={context}
        streaming={false}
        prefetch={false}
        onOpen={() => {}}
        onInspect={() => {}}
      />
    </GlossProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(
    [...view.container.querySelectorAll(".caption-text")].map((p) => p.textContent).join(""),
  ).toBe("なるほど。Dia datang besok. そうなんですね。");
  expect(view.container.querySelectorAll(".caption-translation")).toHaveLength(1);
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

it("does not discard translations requested by a long visible transcript", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const { requests } = JSON.parse(options!.body as string);
    return new Response(
      JSON.stringify({
        entries: requests.map((r: TranslationRequest) => ({
          key: translationKey(r),
          translation: r.sentence,
        })),
      }),
    );
  });
  const results = Promise.all(
    Array.from({ length: 28 }, (_, i) =>
      requestTranslation({ sentence: `Kalimat ${i}.`, ...context }),
    ),
  );
  await vi.advanceTimersByTimeAsync(50);
  expect(await results).toHaveLength(28);
});
