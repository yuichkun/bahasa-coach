import { useCallback, useEffect, useRef } from "react";

export function MicControl({
  muted,
  disabled,
  connecting,
  onChange,
}: {
  muted: boolean;
  disabled: boolean;
  connecting: boolean;
  onChange: (muted: boolean) => void;
}) {
  const latest = useRef({ muted, disabled, onChange });
  latest.current = { muted, disabled, onChange };
  const toggle = useCallback(() => {
    const state = latest.current;
    if (state.disabled) return;
    state.muted = !state.muted;
    state.onChange(state.muted);
  }, []);
  useEffect(() => {
    if (disabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "m"
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="dialog"], dialog',
        )
      )
        return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [disabled, toggle]);
  return (
    <div className="mic-control">
      <button
        className="mic-toggle"
        type="button"
        disabled={disabled}
        aria-label="マイク"
        aria-pressed={!muted}
        aria-keyshortcuts="M"
        title={`${muted ? "マイクをオンにする" : "マイクをオフにする"} (M)`}
        data-muted={muted}
        onClick={toggle}
      >
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {muted ? (
            <>
              <path d="M9 5a3 3 0 0 1 6 0v4M9 9v3a3 3 0 0 0 5.1 2.1M5 10v2a7 7 0 0 0 12 4.9M19 10v2c0 .5-.1 1-.2 1.5M12 19v3m-4 0h8M3 3l18 18" />
            </>
          ) : (
            <>
              <path d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
            </>
          )}
        </svg>
      </button>
      <span className="mic-state" aria-live="polite">
        {connecting ? "接続中…" : muted ? "マイク オフ" : "マイク オン"}
      </span>
      <span className="mic-shortcut">
        <kbd>M</kbd> で切り替え
      </span>
    </div>
  );
}
