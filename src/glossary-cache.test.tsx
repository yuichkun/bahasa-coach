// @vitest-environment happy-dom
import React, { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Gloss, GlossProvider } from "./Gloss";
import {
  clearGlossCache,
  ingestGlossary,
  peekMeaning,
  requestMeaning,
  warmGlossarySource,
} from "./glossary-cache";
import { wordContext } from "../shared/glossary";
beforeEach(() => clearGlossCache());
afterEach(() => {
  cleanup();
  clearGlossCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("instant dictionary display", () => {
  it("shows reusable dictionary meanings immediately while new context is still loading", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    ingestGlossary({
      entries: [],
      vocabulary: [{ term: "rapat", meaning: "会議／密接な", formal: "rapat", note: "" }],
    });
    const result = await requestMeaning("rapat", "Ada rapat nanti.");
    expect(result.scope).toBe("general");
    expect(result.meaning).toContain("会議");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("shows basic frequent-word meanings without any fetch on hover", () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    render(
      <GlossProvider prefetch={false}>
        <Gloss text="ngerti" />
      </GlossProvider>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "ngerti" }));
    expect(screen.getByRole("dialog").textContent).toContain("mengerti");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("prefetches a sentence in one request before hover without marking assistance", async () => {
    const inspect = vi.fn(),
      context = "Kita menunda rapat.";
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [
            {
              term: "menunda",
              context,
              annotation: { term: "menunda", meaning: "延期する", formal: "menunda", note: "" },
            },
            {
              term: "rapat",
              context,
              annotation: { term: "rapat", meaning: "会議", formal: "rapat", note: "" },
            },
          ],
          vocabulary: [],
        }),
      ),
    );
    render(
      <GlossProvider>
        <Gloss text={context} onInspect={inspect} />
      </GlossProvider>,
    );
    await waitFor(() => expect(peekMeaning("rapat", context)?.scope).toBe("context"));
    expect(inspect).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/glossary/prepare");
    fireEvent.mouseEnter(screen.getByRole("button", { name: "rapat" }));
    expect(screen.getByRole("dialog").textContent).toContain("会議");
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps a finished sentence cached when more speech is appended", async () => {
    const text = "Kita menunda rapat.";
    ingestGlossary({
      entries: [
        {
          term: "rapat",
          context: text,
          annotation: { term: "rapat", meaning: "会議", formal: "rapat", note: "" },
        },
      ],
      vocabulary: [],
    });
    const fetcher = vi.spyOn(globalThis, "fetch");
    const extended = text + " Besok kita mulai lagi.";
    expect((await requestMeaning("rapat", wordContext(extended, 13))).meaning).toBe("会議");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("restores browser cache across reload without requiring a server or model", async () => {
    vi.useFakeTimers();
    const context = "Jadwal rapat berubah.";
    ingestGlossary({
      entries: [
        {
          term: "jadwal",
          context,
          annotation: { term: "jadwal", meaning: "予定", formal: "jadwal", note: "" },
        },
      ],
      vocabulary: [{ term: "jadwal", meaning: "予定、日程", formal: "jadwal", note: "" }],
    });
    await vi.advanceTimersByTimeAsync(250);
    clearGlossCache(true);
    const fetcher = vi.spyOn(globalThis, "fetch");
    expect((await requestMeaning("jadwal", context)).meaning).toBe("予定");
    expect(peekMeaning("jadwal", "Apa jadwalmu?")?.scope).toBe("general");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("shows dictionary senses rather than a stale contextual meaning while another sense loads", () => {
    ingestGlossary({
      entries: [
        {
          term: "bisa",
          context: "Aku bisa datang.",
          annotation: { term: "bisa", meaning: "できる", formal: "bisa", note: "" },
        },
      ],
      vocabulary: [],
    });
    const value = peekMeaning("bisa", "Bisa ular itu berbahaya.");
    expect(value?.scope).toBe("general");
    expect(value?.meaning).toContain("毒");
  });
  it("coalesces continuous partial speech and prefetches the completed sentence", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ entries: [], vocabulary: [], pending: [] })),
      );
    for (const text of ["Me", "Menu", "Menunda", "Menunda ra", "Menunda rapat"]) {
      warmGlossarySource("live", text, true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
    warmGlossarySource("live", "Menunda rapat.", true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = fetcher.mock.calls[0][1]?.body;
    const sent = JSON.parse(typeof body === "string" ? body : "");
    expect(sent.requests.map((r: { term: string }) => r.term)).toEqual(["Menunda", "rapat"]);
  });
});
