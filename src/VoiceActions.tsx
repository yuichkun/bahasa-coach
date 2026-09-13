import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";

export function VoiceActions({
  owner,
  disabled,
  onError,
}: {
  owner: string;
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  // Render status outside the closed menu without introducing a new panel.
  const [statusHost, setStatusHost] = useState<HTMLElement | null>(null);
  return (
    <>
      {[
        ["repeat", "もう一度言ってもらう"],
        ["slow", "ゆっくり話してもらう"],
        ["japanese", "日本語で説明してもらう"],
      ].map(([action, label]) => (
        <button
          key={action}
          disabled={disabled || pending}
          onClick={async (event) => {
            const menu = event.currentTarget.closest("details");
            setStatusHost(menu?.parentElement || null);
            if (menu) {
              menu.open = false;
              menu.querySelector("summary")?.focus();
            }
            setPending(true);
            setStatus("コーチへの操作を送信中…");
            try {
              await api("/live/action", { owner, action });
              setStatus("");
            } catch (error) {
              setStatus("");
              onError((error as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          {label}
        </button>
      ))}
      {status &&
        statusHost &&
        createPortal(
          <span className="connection-state" role="status">
            {status}
          </span>,
          statusHost,
        )}
    </>
  );
}
