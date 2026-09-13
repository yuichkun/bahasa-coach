import { useCallback, useEffect, useRef, useState } from "react";

export function MicControl({
  muted,
  disabled,
  connecting,
  stopping = false,
  stopUnconfirmed = false,
  onChange,
  descriptionId,
}: {
  descriptionId?: string;
  muted: boolean;
  disabled: boolean;
  connecting: boolean;
  stopping?: boolean;
  stopUnconfirmed?: boolean;
  onChange: (muted: boolean) => void | Promise<void>;
}) {
  const latest = useRef({ muted, disabled, onChange });
  latest.current = { muted, disabled, onChange };
  const pending = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const toggle = useCallback(() => {
    const state = latest.current;
    if (state.disabled || pending.current) return;
    pending.current = true;
    setWaiting(true);
    const settled = () => {
      pending.current = false;
      setWaiting(false);
    };
    try {
      const result = state.onChange(!state.muted);
      if (result) void result.then(settled, settled);
      else settled();
    } catch (error) {
      settled();
      throw error;
    }
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
  const action = stopping
    ? "停止中…"
    : connecting
      ? "接続中…"
      : stopUnconfirmed
        ? "停止を再試行"
        : muted
          ? "マイクを再開"
          : "マイクを止める";
  return (
    <div className="mic-control">
      <button
        className="mic-toggle"
        type="button"
        disabled={disabled || waiting}
        aria-label={action}
        aria-describedby={descriptionId}
        aria-keyshortcuts="M"
        aria-busy={connecting || stopping || waiting}
        title={`${action} (M)`}
        data-muted={muted}
        onClick={toggle}
      >
        <span className="mic-symbol">
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
        </span>
        <span className="mic-action">{action}</span>
      </button>
      <span className="mic-shortcut">
        <kbd>M</kbd> で切り替え
      </span>
    </div>
  );
}
