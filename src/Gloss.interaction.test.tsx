// @vitest-environment happy-dom
import React from "react";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Gloss, GlossProvider, clearGlossCache } from "./Gloss";
beforeEach(() => {
  clearGlossCache();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("dictionary interaction without a browser", () => {
  it("closes an unfinished-word lookup when live text completes that word", async () => {
    let finish!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <GlossProvider prefetch={false}>
        <Gloss text="me" />
      </GlossProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "me" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(
      <GlossProvider prefetch={false}>
        <Gloss text="mengerti" />
      </GlossProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    finish(new Response(JSON.stringify({ term: "me", meaning: "古い結果", formal: "", note: "" })));
    await waitFor(() => expect(screen.queryByText("古い結果")).toBeNull());
  });
  it("looks up a live-caption word on hover and renders outside the scrolling transcript", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          term: "dengerin",
          meaning: "聞く",
          formal: "mendengarkan",
          note: "口語",
        }),
      ),
    );
    render(
      <GlossProvider prefetch={false}>
        <div data-testid="transcript" style={{ overflow: "hidden" }}>
          <Gloss text="Aku dengerin sekarang." />
        </div>
      </GlossProvider>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "dengerin" }));
    const dialog = await screen.findByRole("dialog", { name: "dengerinの意味" });
    await waitFor(() => expect(dialog.textContent).toContain("mendengarkan"));
    expect(dialog.parentElement).toBe(document.body);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps a known meaning open on focus followed by click", async () => {
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
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("tidak"));
  });
  it("does not replace a newly selected word with a late result for a different word", async () => {
    let finish!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => {
      const { term } = JSON.parse(typeof options?.body === "string" ? options?.body : "");
      if (term === "mengatur")
        return new Promise((resolve) => {
          finish = resolve;
        });
      return Promise.resolve(
        new Response(
          JSON.stringify({ term: "datang", meaning: "来る", formal: "datang", note: "" }),
        ),
      );
    });
    render(
      <GlossProvider prefetch={false}>
        <Gloss text="mengatur datang" />
      </GlossProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "mengatur" }));
    fireEvent.click(screen.getByRole("button", { name: "datang" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("来る"));
    finish(
      new Response(
        JSON.stringify({ term: "mengatur", meaning: "調整する", formal: "mengatur", note: "" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("datangの意味"),
    );
    expect(screen.getByRole("dialog").textContent).not.toContain("調整する");
  });
  it("allows retry after a failed lookup", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ term: "besok", meaning: "明日", formal: "besok", note: "" })),
      );
    render(
      <GlossProvider prefetch={false}>
        <Gloss text="besok" />
      </GlossProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "besok" }));
    await screen.findByRole("button", { name: "再試行" });
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("明日"));
  });
});
