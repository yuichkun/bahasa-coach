import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Annotation } from "../shared/types";
import { api } from "./api";

const cache = new Map<string, Promise<Annotation>>();
type Selection = {
  key: string;
  term: string;
  context: string;
  anchor: HTMLElement;
  annotation?: Annotation;
  onOpen?: () => void;
  onInspect?: () => void;
};
type Controller = {
  selected: HTMLElement | null;
  tooltipId: string;
  offer: (s: Selection, immediately?: boolean) => void;
  leave: () => void;
  close: () => void;
  keep: () => void;
};
const Context = createContext<Controller | null>(null);
function fetchMeaning(selection: Selection) {
  if (selection.annotation) return Promise.resolve(selection.annotation);
  const existing = cache.get(selection.key);
  if (existing) return existing;
  const promise = api<Annotation>("/lookup", {
    term: selection.term,
    context: selection.context,
  }).catch((error) => {
    cache.delete(selection.key);
    throw error;
  });
  cache.set(selection.key, promise);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return promise;
}
export function clearGlossCache() {
  cache.clear();
}
export function GlossProvider({ children }: { children: ReactNode }) {
  const tooltipId = useId(),
    [selection, setSelection] = useState<Selection | null>(null),
    [value, setValue] = useState<Annotation | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    panel = useRef<HTMLDivElement>(null);
  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const close = useCallback(() => {
    clearTimers();
    setSelection(null);
  }, []);
  const keep = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const offer = (s: Selection, immediately = false) => {
    clearTimers();
    const show = () => {
      s.onOpen?.();
      setValue(s.annotation ?? null);
      setError("");
      setSelection(s);
    };
    if (immediately) show();
    else openTimer.current = setTimeout(show, 180);
  };
  const leave = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(close, 180);
  };
  useEffect(() => {
    if (!selection) return;
    let alive = true;
    void fetchMeaning(selection)
      .then((result) => {
        if (
          alive &&
          selection.anchor.isConnected &&
          selection.anchor.textContent === selection.term
        ) {
          setValue(result);
          selection.onInspect?.();
        }
      })
      .catch(() => {
        if (alive) setError("意味を取得できませんでした。");
      });
    return () => {
      alive = false;
    };
  }, [selection, retry]);
  useEffect(() => {
    if (!selection) return;
    const place = () => {
      if (!selection.anchor.isConnected || selection.anchor.textContent !== selection.term) {
        close();
        return;
      }
      const r = selection.anchor.getBoundingClientRect(),
        height = panel.current?.offsetHeight || 160;
      if (r.bottom < 0 || r.top > window.innerHeight) {
        close();
        return;
      }
      setPosition({
        left: Math.max(12, Math.min(r.left, window.innerWidth - 292)),
        top:
          r.bottom + height + 12 < window.innerHeight
            ? r.bottom + 8
            : Math.max(12, r.top - height - 8),
      });
    };
    const outside = (e: MouseEvent) => {
      if (
        !selection.anchor.contains(e.target as Node) &&
        !panel.current?.contains(e.target as Node)
      )
        close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    selection.anchor.setAttribute("aria-describedby", tooltipId);
    selection.anchor.setAttribute("aria-expanded", "true");
    const observer = new MutationObserver(() => {
      if (!selection.anchor.isConnected || selection.anchor.textContent !== selection.term) close();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      selection.anchor.removeAttribute("aria-describedby");
      selection.anchor.removeAttribute("aria-expanded");
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [selection, value, error, close, tooltipId]);
  useEffect(() => () => clearTimers(), []);
  return (
    <Context.Provider
      value={{ selected: selection?.anchor ?? null, tooltipId, offer, leave, close, keep }}
    >
      {children}
      {selection &&
        createPortal(
          <div
            ref={panel}
            id={tooltipId}
            role="dialog"
            aria-label={`${selection.term}の意味`}
            className="word-popover"
            style={position}
            onMouseEnter={keep}
            onMouseLeave={leave}
          >
            <div className="word-heading">
              <strong>{selection.term}</strong>
              <button onClick={close} aria-label="単語の説明を閉じる">
                ×
              </button>
            </div>
            {value ? (
              <>
                <p>{value.meaning}</p>
                {value.formal && (
                  <div className="word-formal">
                    <span>正式形</span>
                    {value.formal}
                  </div>
                )}
                {value.note && <small>{value.note}</small>}
              </>
            ) : error ? (
              <>
                <p role="alert">{error}</p>
                <button
                  className="text-button"
                  onClick={() => {
                    setError("");
                    setRetry((n) => n + 1);
                  }}
                >
                  再試行
                </button>
              </>
            ) : (
              <p role="status" className="muted">
                意味を調べています…
              </p>
            )}
          </div>,
          document.body,
        )}
    </Context.Provider>
  );
}

export function Gloss({
  text,
  annotations = [],
  onInspect,
  onOpen,
}: {
  text: string;
  annotations?: Annotation[];
  onInspect?: () => void;
  onOpen?: () => void;
}) {
  const controller = useContext(Context);
  const lookup = new Map(
    annotations
      .filter((a) => /^[\p{Script=Latin}\p{M}]+(?:[-’'][\p{Script=Latin}\p{M}]+)*$/u.test(a.term))
      .map((a) => [a.term.toLocaleLowerCase("id"), a]),
  );
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(
    /[\p{Script=Latin}\p{M}]+(?:[-’'][\p{Script=Latin}\p{M}]+)*/gu,
  )) {
    const index = match.index,
      term = match[0];
    if (index > cursor)
      result.push(<span key={`text-${cursor}`}>{text.slice(cursor, index)}</span>);
    const context = text.slice(
      Math.max(0, index - 120),
      Math.min(text.length, index + term.length + 180),
    );
    const open = (anchor: HTMLElement, immediately = false) => {
      controller?.offer(
        {
          key: term.toLocaleLowerCase("id") + "\n" + context,
          term,
          context,
          anchor,
          annotation: lookup.get(term.toLocaleLowerCase("id")),
          onInspect,
          onOpen,
        },
        immediately,
      );
    };
    result.push(
      <button
        key={`word-${index}`}
        className="term"
        type="button"
        aria-haspopup="dialog"
        onMouseEnter={(e) => open(e.currentTarget)}
        onMouseLeave={() => controller?.leave()}
        onFocus={(e) => open(e.currentTarget, true)}
        onBlur={(e) => {
          if (!(e.relatedTarget as HTMLElement | null)?.closest(".word-popover"))
            controller?.leave();
        }}
        onClick={(e) => open(e.currentTarget, true)}
      >
        {term}
      </button>,
    );
    cursor = index + term.length;
  }
  if (cursor < text.length) result.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  return <>{result}</>;
}
