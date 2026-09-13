import { useEffect, useRef, useState } from "react";
import { translationKey, type TranslationRequest } from "../shared/translation";
import { peekTranslation, requestTranslation } from "./translation-cache";

export function SentenceMeaning({
  request,
  onInspect,
}: {
  request: TranslationRequest;
  onInspect?: () => void;
}) {
  const key = translationKey(request);
  const [result, setResult] = useState<{ key: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const inspected = useRef("");
  const value = peekTranslation(request) || (result?.key === key ? result.value : "");
  useEffect(() => {
    let alive = true;
    setError("");
    void requestTranslation(request)
      .then((value) => {
        if (alive) setResult({ key, value });
      })
      .catch(() => {
        if (alive) setError("文の訳を取得できませんでした。");
      });
    return () => {
      alive = false;
    };
  }, [key, retry]);
  useEffect(() => {
    if (value && inspected.current !== key) {
      inspected.current = key;
      onInspect?.();
    }
  }, [value, key, onInspect]);
  return (
    <section className="sentence-meaning" aria-label="文全体の意味">
      <span>文全体</span>
      {value ? (
        <p lang="ja">{value}</p>
      ) : error ? (
        <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
          訳を再取得する
        </button>
      ) : (
        <p className="sentence-loading" role="status">
          前後の会話から訳しています…
        </p>
      )}
      <small lang="id">{request.sentence}</small>
    </section>
  );
}
