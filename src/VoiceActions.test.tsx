// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { VoiceActions } from "./VoiceActions";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("closes the menu, sends a control identifier and waits for acceptance without writing speech", async () => {
  let finish!: (r: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onError = vi.fn();
  const rendered = render(
    <div>
      <details open>
        <summary>その他</summary>
        <VoiceActions owner="owner" disabled={false} onError={onError} />
      </details>
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "もう一度言ってもらう" }));
  expect(rendered.container.querySelector("details")!.open).toBe(false);
  expect(document.activeElement).toBe(rendered.container.querySelector("summary"));
  expect(screen.getByRole("status").textContent).toBe("コーチへの操作を送信中…");
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("/api/live/action");
  expect(JSON.parse(options!.body as string)).toEqual({ owner: "owner", action: "repeat" });
  await act(async () => {
    finish(new Response(JSON.stringify({ ok: true })));
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(onError).not.toHaveBeenCalled();
});
it("reports control failures instead of showing success", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "操作を確認できませんでした。" }), { status: 500 }),
  );
  const onError = vi.fn();
  render(
    <details open>
      <summary>その他</summary>
      <VoiceActions owner="owner" disabled={false} onError={onError} />
    </details>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "ゆっくり話してもらう" }));
  });
  expect(onError).toHaveBeenCalledWith("操作を確認できませんでした。");
});
