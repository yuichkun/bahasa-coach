import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Annotation } from "../shared/types";
import {
  wordContext,
  sentenceContexts,
  words,
  normalizeWord,
  type GlossValue,
} from "../shared/glossary";
import {
  peekMeaning,
  glossaryRevision,
  seedAnnotations,
  subscribeGlossary,
  warmGlossarySource,
} from "./glossary-cache";
export { clearGlossCache } from "./glossary-cache";

type Selection = {
  term: string;
  context: string;
  anchor: HTMLElement;
  annotation?: Annotation;
  onOpen?: () => void;
  onInspect?: () => void;
};
type Controller = {
  prefetch: boolean;
  selected: HTMLElement | null;
  tooltipId: string;
  offer: (s: Selection) => void;
  leave: () => void;
  close: () => void;
  keep: () => void;
};
const Context = createContext<Controller | null>(null);
export function GlossProvider({
  children,
  prefetch = true,
}: {
  children: ReactNode;
  prefetch?: boolean;
}) {
  const tooltipId = useId(),
    [selection, setSelection] = useState<Selection | null>(null),
    [value, setValue] = useState<GlossValue | null>(null),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    panel = useRef<HTMLDivElement>(null);
  const clearTimers = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const close = useCallback(() => {
    clearTimers();
    setSelection(null);
  }, []);
  const keep = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const offer = (s: Selection) => {
    const ready = s.annotation
      ? { ...s.annotation, scope: "context" as const }
      : peekMeaning(s.term, s.context);
    if (!ready) return;
    clearTimers();
    s.onOpen?.();
    setValue(ready);
    setSelection(s);
  };
  const leave = () => {
    closeTimer.current = setTimeout(close, 180);
  };
  useEffect(() => {
    if (!selection) return;
    let alive = true,
      inspected = false;
    const receive = (result: GlossValue) => {
      if (
        alive &&
        selection.anchor.isConnected &&
        selection.anchor.textContent === selection.term
      ) {
        setValue(result);
        if (!inspected) {
          inspected = true;
          selection.onInspect?.();
        }
      }
    };
    const unsubscribe = subscribeGlossary(() => {
      const value = peekMeaning(selection.term, selection.context);
      if (value) receive(value);
    });
    if (selection.annotation) receive({ ...selection.annotation, scope: "context" });
    else {
      const cached = peekMeaning(selection.term, selection.context);
      if (cached) receive(cached);
    }
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [selection]);
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
    const sizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (panel.current) sizeObserver?.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      sizeObserver?.disconnect();
      selection.anchor.removeAttribute("aria-describedby");
      selection.anchor.removeAttribute("aria-expanded");
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [selection, value, close, tooltipId]);
  useEffect(() => () => clearTimers(), []);
  return (
    <Context.Provider
      value={{
        prefetch,
        selected: selection?.anchor ?? null,
        tooltipId,
        offer,
        leave,
        close,
        keep,
      }}
    >
      {children}
      {selection &&
        value &&
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
            {value?.scope === "general" && <small className="word-scope">基本の意味</small>}
            <p>{value.meaning}</p>
            {value.formal && (
              <div className="word-formal">
                <span>正式形</span>
                {value.formal}
              </div>
            )}
            {value.note && <small>{value.note}</small>}
          </div>,
          document.body,
        )}
    </Context.Provider>
  );
}

const EMPTY_ANNOTATIONS: Annotation[] = [];

export function Gloss({
  text,
  annotations = EMPTY_ANNOTATIONS,
  prefetch = true,
  streaming = false,
  highlight = "",
  onInspect,
  onOpen,
}: {
  text: string;
  annotations?: Annotation[];
  prefetch?: boolean;
  streaming?: boolean;
  highlight?: string;
  onInspect?: () => void;
  onOpen?: () => void;
}) {
  const controller = useContext(Context);
  const sourceId = useId();
  const content = useRef<HTMLSpanElement>(null);
  useSyncExternalStore(subscribeGlossary, glossaryRevision, () => 0);
  const annotationKey = JSON.stringify(annotations);
  useEffect(() => {
    seedAnnotations(text, JSON.parse(annotationKey));
  }, [text, annotationKey]);
  const shouldWarm = prefetch && Boolean(controller?.prefetch);
  useEffect(() => {
    if (!shouldWarm) return;
    if (typeof IntersectionObserver === "undefined")
      return warmGlossarySource(sourceId, text, streaming);
    let stop: (() => void) | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) stop ??= warmGlossarySource(sourceId, text, streaming);
        else {
          stop?.();
          stop = undefined;
        }
      },
      { root: content.current?.closest(".captions") ?? null, rootMargin: "400px" },
    );
    if (content.current) observer.observe(content.current);
    return () => {
      observer.disconnect();
      stop?.();
    };
  }, [sourceId, text, streaming, shouldWarm]);
  const spans = sentenceContexts(text);
  const occurrences = new Map<string, number>();
  for (const w of words(text))
    occurrences.set(normalizeWord(w.term), (occurrences.get(normalizeWord(w.term)) || 0) + 1);
  const lookup = new Map(
    annotations
      .filter((a) => a.meaning.trim() && (occurrences.get(normalizeWord(a.term)) || 0) === 1)
      .filter((a) => /^[\p{Script=Latin}\p{M}]+(?:[-’'][\p{Script=Latin}\p{M}]+)*$/u.test(a.term))
      .map((a) => [a.term.toLocaleLowerCase("id"), a]),
  );
  const result: ReactNode[] = [];
  const highlightStart = highlight ? text.indexOf(highlight) : -1;
  const paint = (value: string, offset: number) => {
    const start = Math.max(0, highlightStart - offset);
    const end = Math.min(value.length, highlightStart + highlight.length - offset);
    return highlightStart >= 0 && end > start ? (
      <>
        {value.slice(0, start)}
        <mark>{value.slice(start, end)}</mark>
        {value.slice(end)}
      </>
    ) : (
      value
    );
  };
  let cursor = 0;
  for (const match of text.matchAll(
    /[\p{Script=Latin}\p{M}]+(?:[-’'][\p{Script=Latin}\p{M}]+)*/gu,
  )) {
    const index = match.index,
      term = match[0];
    if (index > cursor)
      result.push(<span key={`text-${cursor}`}>{paint(text.slice(cursor, index), cursor)}</span>);
    const context = wordContext(text, index, spans);
    const annotation = lookup.get(term.toLocaleLowerCase("id"));
    const ready = annotation || peekMeaning(term, context);
    if (!ready) {
      result.push(<span key={`word-${index}`}>{paint(term, index)}</span>);
      cursor = index + term.length;
      continue;
    }
    const open = (anchor: HTMLElement) => {
      controller?.offer({
        term,
        context,
        anchor,
        annotation,
        onInspect,
        onOpen,
      });
    };
    result.push(
      <button
        key={`word-${index}`}
        className="term"
        type="button"
        aria-haspopup="dialog"
        onMouseEnter={(e) => open(e.currentTarget)}
        onMouseLeave={() => controller?.leave()}
        onFocus={(e) => open(e.currentTarget)}
        onBlur={(e) => {
          if (!(e.relatedTarget as HTMLElement | null)?.closest(".word-popover"))
            controller?.leave();
        }}
        onClick={(e) => open(e.currentTarget)}
      >
        {paint(term, index)}
      </button>,
    );
    cursor = index + term.length;
  }
  if (cursor < text.length)
    result.push(<span key={`text-${cursor}`}>{paint(text.slice(cursor), cursor)}</span>);
  return <span ref={content}>{result}</span>;
}
