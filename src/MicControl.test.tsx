// @vitest-environment happy-dom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { MicControl } from "./MicControl";

afterEach(() => cleanup());
function Fixture({
  changed = vi.fn(),
  disabled = false,
}: {
  changed?: (muted: boolean) => void;
  disabled?: boolean;
}) {
  const [muted, setMuted] = useState(false);
  return (
    <MicControl
      muted={muted}
      disabled={disabled}
      connecting={false}
      onChange={(value) => {
        changed(value);
        setMuted(value);
      }}
    />
  );
}
it("labels the next action explicitly while keeping one microphone button for click and M", () => {
  const changed = vi.fn();
  render(<Fixture changed={changed} />);
  const button = screen.getByRole("button", { name: "マイクを止める" });
  expect(button.getAttribute("aria-label")).toBe("マイクを止める");
  fireEvent.click(button);
  expect(screen.getByText("マイクを再開")).toBeTruthy();
  expect(button.getAttribute("aria-label")).toBe("マイクを再開");
  fireEvent.keyDown(window, { key: "m" });
  expect(screen.getByText("マイクを止める")).toBeTruthy();
  expect(changed.mock.calls).toEqual([[true], [false]]);
});
it.each(["input", "textarea", "select", "editable", "dialog"])(
  "does not toggle while using %s",
  (kind) => {
    const changed = vi.fn();
    const view = render(
      <>
        <Fixture changed={changed} />
        {kind === "editable" ? (
          <div contentEditable>
            <span>Editing</span>
          </div>
        ) : kind === "dialog" ? (
          <div role="dialog">
            <button>操作</button>
          </div>
        ) : (
          React.createElement(kind)
        )}
      </>,
    );
    const target =
      kind === "editable"
        ? view.container.querySelector("span[hidden], [contenteditable] span")!
        : kind === "dialog"
          ? screen.getByRole("button", { name: "操作" })
          : view.container.querySelector(kind)!;
    fireEvent.keyDown(target, { key: "m" });
    expect(changed).not.toHaveBeenCalled();
  },
);
it("ignores key repeat, IME composition and modified shortcuts", () => {
  const changed = vi.fn();
  render(<Fixture changed={changed} />);
  for (const modifiers of [
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
  ]) {
    fireEvent.keyDown(window, { key: "m", ...modifiers });
  }
  expect(changed).not.toHaveBeenCalled();
});
it("does not intercept an event already handled by another control", () => {
  const changed = vi.fn();
  render(<Fixture changed={changed} />);
  const event = new KeyboardEvent("keydown", { key: "m", cancelable: true });
  event.preventDefault();
  window.dispatchEvent(event);
  expect(changed).not.toHaveBeenCalled();
});
it("disables shortcuts when disconnected and removes them when leaving the voice screen", () => {
  const changed = vi.fn();
  const view = render(<Fixture changed={changed} disabled />);
  fireEvent.keyDown(window, { key: "m" });
  fireEvent.click(screen.getByRole("button", { name: "マイクを止める" }));
  expect(changed).not.toHaveBeenCalled();
  view.rerender(<Fixture changed={changed} />);
  fireEvent.keyDown(window, { key: "m" });
  expect(changed).toHaveBeenCalledTimes(1);
  view.unmount();
  fireEvent.keyDown(window, { key: "m" });
  expect(changed).toHaveBeenCalledTimes(1);
});
