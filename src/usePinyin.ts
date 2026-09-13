import { asError } from "../shared/errors";
import { useEffect, useMemo, useState } from "react";

type Reader = typeof import("../shared/pinyin").pinyinSpans;
let reader: Reader | undefined;
let loading: Promise<Reader> | undefined;

export function usePinyin(text: string, enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!enabled || reader) return;
    let alive = true;
    const load = () => {
      loading ??= import("../shared/pinyin")
        .then((module) => (reader = module.pinyinSpans))
        .catch((error) => {
          loading = undefined;
          throw error;
        });
      void loading
        .then(() => {
          if (alive) setRevision((v) => v + 1);
        })
        .catch((cause) => {
          if (alive)
            setError(
              new Error("ピンイン用データの読み込みに失敗しました。", { cause: asError(cause) }),
            );
        });
    };
    load();
    window.addEventListener("online", load);
    return () => {
      alive = false;
      window.removeEventListener("online", load);
    };
  }, [enabled]);
  const result = useMemo(() => (enabled && reader ? reader(text) : []), [text, enabled, revision]);
  if (error && enabled) throw error;
  return result;
}
