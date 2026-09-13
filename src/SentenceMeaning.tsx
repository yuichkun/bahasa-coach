import { useEffect, useRef, useState } from "react";
import { translationKey, type TranslationRequest } from "../shared/translation";
import { peekTranslation, acquireTranslation } from "./translation-cache";
import {
  DEFAULT_TRANSLATION_PRECISION,
  type TranslationPrecision,
} from "../shared/translation-settings";
import { sentenceEnded } from "../shared/transcript";

export function SentenceMeaning({
  request,
  streaming = false,
  precision = DEFAULT_TRANSLATION_PRECISION,
}: {
  request: TranslationRequest;
  streaming?: boolean;
  precision?: TranslationPrecision;
}) {
  const key = translationKey(request, precision);
  // Keep a readable translation while subsequent speech adds context. A change
  // to the sentence or its preceding context must invalidate the displayed text.
  const anchor = translationKey({ ...request, after: [] });
  const [result, setResult] = useState<{
    anchor: string;
    value: string;
    precision: TranslationPrecision;
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const cached = peekTranslation(request, precision);
  const value = cached || (result?.anchor === anchor ? result.value : "");
  const latest = useRef(request);
  latest.current = request;
  // Later conversation must not restart the timer or requeue the same live line.
  // Snapshot all available before/after context when this translation starts.
  const effectKey = streaming ? anchor : key;
  useEffect(() => {
    let alive = true;
    let lease: ReturnType<typeof acquireTranslation> | undefined;
    setError("");
    // A preference change applies to pending/new translations, not a full
    // retranslation of every completed caption already on screen.
    if (result?.anchor === anchor && result.precision !== precision) return;
    const receive = (value: string) => {
      if (alive) setResult({ anchor, value, precision });
    };
    const hit = peekTranslation(latest.current, precision);
    if (hit) {
      receive(hit);
      return;
    }
    const run = () => {
      lease = acquireTranslation(latest.current, precision);
      void lease.promise.then(receive).catch(() => {
        if (alive) setError("訳を取得できませんでした。");
      });
    };
    const delay = sentenceEnded(request.sentence)
      ? 150
      : precision === "fast"
        ? 500
        : precision === "balanced"
          ? 700
          : 900;
    const timer = streaming ? setTimeout(run, delay) : undefined;
    if (!streaming) run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      lease?.release();
    };
  }, [effectKey, retry, streaming, precision]);
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
