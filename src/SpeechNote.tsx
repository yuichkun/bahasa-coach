import { useEffect, useRef, useState } from "react";
import type { SpeechFeedback } from "../shared/types";
import { Gloss } from "./Gloss";
import { api } from "./api";

export function SpeechNote({
  lessonId,
  source,
  feedback,
  onShown,
  onInspect,
  onOpen,
}: {
  lessonId: string;
  source: string;
  feedback?: SpeechFeedback;
  onShown: () => void;
  onInspect: () => void;
  onOpen: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const shown = useRef("");
  const current = feedback?.source === source ? feedback : undefined;
  const result = current?.status === "ready" ? current.result : null;
  useEffect(() => {
    if (result?.outcome !== "correction" || shown.current === source) return;
    shown.current = source;
    onShown();
  }, [result, source, onShown]);
  if (current?.status === "error")
    return (
      <div className="speech-note-error">
        <span>この発言の添削を取得できませんでした。</span>
        <button
          className="text-button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            setError("");
            try {
              await api(`/lessons/${lessonId}/speech-feedback/retry`, { blockId: current.blockId });
            } catch {
              setError("再試行できませんでした。接続設定を確認してください。");
            } finally {
              setRetrying(false);
            }
          }}
        >
          再試行
        </button>
        {error && <span role="alert">{error}</span>}
      </div>
    );
  if (result?.outcome !== "correction") return null;
  return (
    <aside className="speech-note" aria-label="この発言の添削">
      <span className="speech-note-label">こう言うと自然</span>
      <p className="speech-note-original">「{result.original}」</p>
      <p className="speech-note-natural" dir="auto">
        <Gloss
          text={result.natural}
          annotations={result.annotations}
          onOpen={onOpen}
          onInspect={onInspect}
        />
      </p>
      <p className="speech-note-reason">
        <Gloss
          text={result.explanation}
          annotations={result.annotations}
          onOpen={onOpen}
          onInspect={onInspect}
        />
      </p>
    </aside>
  );
}
