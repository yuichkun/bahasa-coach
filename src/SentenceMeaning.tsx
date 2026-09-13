import { useEffect, useState } from "react";
import { translationKey, type TranslationRequest } from "../shared/translation";
import { peekTranslation, requestTranslation } from "./translation-cache";

export function SentenceMeaning({
  request,
  streaming = false,
}: {
  request: TranslationRequest;
  streaming?: boolean;
}) {
  const key = translationKey(request);
  // Keep a readable translation while subsequent speech adds context. A change
  // to the sentence or its preceding context must invalidate the displayed text.
  const anchor = translationKey({ ...request, after: [] });
  const [result, setResult] = useState<{ anchor: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const cached = peekTranslation(request);
  const value = cached || (result?.anchor === anchor ? result.value : "");
  useEffect(() => {
    let alive = true;
    setError("");
    const receive = (value: string) => {
      if (alive) setResult({ anchor, value });
    };
    const hit = peekTranslation(request);
    if (hit) {
      receive(hit);
      return;
    }
    const run = () => {
      void requestTranslation(request)
        .then(receive)
        .catch(() => {
          if (alive) setError("訳を取得できませんでした。");
        });
    };
    const timer = streaming ? setTimeout(run, 1200) : undefined;
    if (!streaming) run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, retry, streaming]);
  return (
    <p
      className={`caption-translation${!value && !error ? " is-loading" : ""}`}
      lang="ja"
      aria-label="日本語訳"
    >
      {value ||
        (error ? (
          <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
            訳を再取得する
          </button>
        ) : (
          "訳しています…"
        ))}
    </p>
  );
}
