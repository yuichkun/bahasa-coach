// @vitest-environment happy-dom
import React, { act } from "react";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Gloss, GlossProvider, clearGlossCache } from "./Gloss";
import { ingestGlossary } from "./glossary-cache";
beforeEach(() => {
  clearGlossCache();
  vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(() => {
  cleanup();
  clearGlossCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("ready-only dictionary interaction without a browser", () => {
  it("keeps missing meanings as plain text, then enables instant hover when prefetch finishes", async () => {
    let finish!: (r: Response) => void;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const inspect = vi.fn();
    render(
      <GlossProvider>
        <Gloss text="Dengerin." onInspect={inspect} />
      </GlossProvider>,
    );
    const pendingWord = screen.getByText("Dengerin");
    expect(pendingWord.tagName).toBe("SPAN");
    expect(pendingWord.classList.contains("term")).toBe(false);
    fireEvent.mouseEnter(pendingWord);
    fireEvent.click(pendingWord);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0][0]).toBe("/api/glossary/prepare");
    await act(async () =>
      finish(
        new Response(
          JSON.stringify({
            entries: [
              {
                term: "Dengerin",
                context: "Dengerin.",
                annotation: {
                  term: "Dengerin",
                  meaning: "聞く",
                  formal: "mendengarkan",
                  note: "口語",
                },
              },
            ],
            vocabulary: [],
          }),
        ),
      ),
    );
    const readyWord = screen.getByRole("button", { name: "Dengerin" });
    expect(inspect).not.toHaveBeenCalled();
    fireEvent.mouseEnter(readyWord);
    expect(screen.getByRole("dialog").textContent).toContain("mendengarkan");
    expect(screen.queryByText("意味を調べています…")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
  });
  it("closes an inspected token when streaming text changes it", async () => {
    const view = render(
      <GlossProvider prefetch={false}>
        <Gloss text="ngerti" />
      </GlossProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ngerti" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(
      <GlossProvider prefetch={false}>
        <Gloss text="ngertinya" />
      </GlossProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "ngertinya" })).toBeNull();
  });
  it("renders cached meanings outside the scrolling transcript and supports Escape", () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    ingestGlossary({
      entries: [],
      vocabulary: [{ term: "dengerin", meaning: "聞く", formal: "mendengarkan", note: "口語" }],
    });
    render(
      <GlossProvider prefetch={false}>
        <div style={{ overflow: "hidden" }}>
          <Gloss text="Aku dengerin sekarang." />
        </div>
      </GlossProvider>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "dengerin" }));
    const dialog = screen.getByRole("dialog", { name: "dengerinの意味" });
    expect(dialog.textContent).toContain("mendengarkan");
    expect(dialog.parentElement).toBe(document.body);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps a known meaning open on focus followed by click", () => {
    render(
      <GlossProvider prefetch={false}>
        <Gloss
          text="nggak"
          annotations={[{ term: "nggak", meaning: "〜ない", formal: "tidak", note: "口語" }]}
        />
      </GlossProvider>,
    );
    const word = screen.getByRole("button", { name: "nggak" });
    fireEvent.focus(word);
    fireEvent.click(word);
    expect(screen.getByRole("dialog").textContent).toContain("tidak");
  });
  it("does not replace the selected word with a late prefetch result for another word", () => {
    ingestGlossary({
      entries: [],
      vocabulary: [
        { term: "mengatur", meaning: "調整する／配置する", formal: "mengatur", note: "" },
        { term: "datang", meaning: "来る", formal: "datang", note: "" },
      ],
    });
    render(
      <GlossProvider prefetch={false}>
        <Gloss text="mengatur datang" />
      </GlossProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "mengatur" }));
    fireEvent.click(screen.getByRole("button", { name: "datang" }));
    act(() =>
      ingestGlossary({
        entries: [
          {
            term: "mengatur",
            context: "mengatur datang",
            annotation: { term: "mengatur", meaning: "調整する", formal: "mengatur", note: "" },
          },
        ],
        vocabulary: [],
      }),
    );
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("datangの意味");
    expect(screen.getByRole("dialog").textContent).toContain("来る");
    expect(screen.getByRole("dialog").textContent).not.toContain("調整する");
  });
  it("keeps failed background definitions inert without showing an empty popup", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    render(
      <GlossProvider>
        <Gloss text="Besok." />
      </GlossProvider>,
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    fireEvent.mouseEnter(screen.getByText("Besok"));
    expect(screen.queryByRole("button", { name: "Besok" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("prepares offscreen text when it approaches the reading area, before pointer interaction", async () => {
    let notify!: (entries: { isIntersecting: boolean }[]) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ entries: [], vocabulary: [], pending: [] })),
      );
    render(
      <GlossProvider>
        <Gloss text="Membaca." />
      </GlossProvider>,
    );
    act(() => notify([{ isIntersecting: false }]));
    expect(fetcher).not.toHaveBeenCalled();
    act(() => notify([{ isIntersecting: true }]));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });
});
