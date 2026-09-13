// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { TranslationSettings } from "./TranslationSettings";
afterEach(cleanup);
it("offers three understandable precision levels without model or effort controls", () => {
  const changed = vi.fn();
  const view = render(<TranslationSettings value="fast" disabled={false} onChange={changed} />);
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  expect((screen.getByRole("radio", { name: "速さ優先" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "精度優先" }));
  expect(changed).toHaveBeenCalledWith("precise");
  expect(view.container.textContent).not.toMatch(/gpt-|reasoning|effort/i);
});
