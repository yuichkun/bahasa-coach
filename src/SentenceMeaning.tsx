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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0,
      inFlight = false,
      waiting = false;
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
      timer = undefined;
      if (!alive || inFlight) return;
      if (navigator.onLine === false) {
        waiting = true;
        return;
      }
      waiting = false;
      inFlight = true;
      const current = acquireTranslation(latest.current, precision);
      lease = current;
      void current.promise
        .then(receive)
        .catch(() => {
          if (!alive) return;
          waiting = true;
          // Brief failures recover quickly; persistent failures back off without
          // turning every caption into a button the learner has to manage.
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
          timer = setTimeout(run, delay);
        })
        .finally(() => {
          inFlight = false;
          current.release();
          if (lease === current) lease = undefined;
        });
    };
    const resume = () => {
      if (!alive || inFlight || !waiting) return;
      if (timer) clearTimeout(timer);
      failures = 0;
      timer = setTimeout(run, 150);
    };
    window.addEventListener("online", resume);
    const delay = sentenceEnded(request.sentence)
      ? 150
      : precision === "fast"
        ? 500
        : precision === "balanced"
          ? 700
          : 900;
    timer = streaming ? setTimeout(run, delay) : undefined;
    if (!streaming) run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      lease?.release();
      window.removeEventListener("online", resume);
    };
  }, [effectKey, streaming, precision]);
  return (
    <p
      className={`caption-translation${!value ? " is-loading" : ""}`}
      lang="ja"
      aria-label="日本語訳"
    >
      {value || "訳しています…"}
    </p>
  );
}
