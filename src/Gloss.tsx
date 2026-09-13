import { useLanguage } from "./LanguageContext";
import { usePinyin } from "./usePinyin";
import type { Language } from "../shared/languages";
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
  language?: Language;
  reading?: string;
  context: string;
  anchor: HTMLElement;
  annotation?: Annotation;
  onOpen?: () => void;
  onInspect?: () => void;
};
function selectionMatches(selection: Selection) {
  return (
    selection.anchor.isConnected &&
    (selection.anchor.querySelector(".term-source")?.textContent ??
      selection.anchor.textContent) === selection.term &&
    selection.anchor.dataset.language === (selection.language ?? "id")
  );
}
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
      : peekMeaning(s.term, s.context, s.language);
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
      if (alive && selectionMatches(selection)) {
        setValue(result);
        if (!inspected) {
          inspected = true;
          selection.onInspect?.();
        }
      }
    };
    const unsubscribe = subscribeGlossary(() => {
      const value = peekMeaning(selection.term, selection.context, selection.language);
      if (value) receive(value);
    });
    if (selection.annotation) receive({ ...selection.annotation, scope: "context" });
    else {
      const cached = peekMeaning(selection.term, selection.context, selection.language);
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
      if (!selectionMatches(selection)) {
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
      if (!selectionMatches(selection)) close();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-language"],
    });
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
            {selection.reading && (
              <p className="word-reading" lang="zh-Latn">
                {selection.reading}
              </p>
            )}
            <p>{value.meaning}</p>
            {value.formal && (
              <div className="word-formal">
                <span>
                  {!selection.language || selection.language === "id"
                    ? "正式形"
                    : "丁寧な表現・標準形"}
                </span>
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
  japanese = false,
  onInspect,
  onOpen,
}: {
  text: string;
  annotations?: Annotation[];
  prefetch?: boolean;
  streaming?: boolean;
  highlight?: string;
  japanese?: boolean;
  onInspect?: () => void;
  onOpen?: () => void;
}) {
  const controller = useContext(Context);
  const { language, pinyin: showPinyin } = useLanguage();
  const readings = usePinyin(text, language === "zh-Hans" && showPinyin);
  const sourceId = useId();
  const content = useRef<HTMLSpanElement>(null);
  useSyncExternalStore(subscribeGlossary, glossaryRevision, () => 0);
  const annotationKey = JSON.stringify(annotations);
  useEffect(() => {
    if (!(japanese && language === "zh-Hans"))
      seedAnnotations(text, JSON.parse(annotationKey), language);
  }, [text, annotationKey, language, japanese]);
  const shouldWarm =
    prefetch && !(japanese && language === "zh-Hans") && Boolean(controller?.prefetch);
  useEffect(() => {
    if (!shouldWarm) return;
    if (typeof IntersectionObserver === "undefined")
      return warmGlossarySource(sourceId, text, streaming, language);
    let stop: (() => void) | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) stop ??= warmGlossarySource(sourceId, text, streaming, language);
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
  }, [sourceId, text, streaming, shouldWarm, language]);
  const explicitOnly = japanese && language === "zh-Hans";
  const spans = sentenceContexts(text, language);
  const tokens = explicitOnly
    ? annotations
        .flatMap((a) => {
          const index = text.indexOf(a.term);
          return a.term && index >= 0 && words(a.term, language).length
            ? [{ term: a.term, index }]
            : [];
        })
        .sort((a, b) => a.index - b.index || b.term.length - a.term.length)
    : words(text, language);
  const readingHelp = readings.length > 0 && tokens.length > 0;
  useEffect(() => {
    if (readingHelp) onInspect?.();
  }, [text, readingHelp]);
  const occurrences = new Map<string, number>();
  for (const w of tokens)
    occurrences.set(normalizeWord(w.term), (occurrences.get(normalizeWord(w.term)) || 0) + 1);
  const lookup = new Map(
    annotations
      .filter((a) => a.meaning.trim() && (occurrences.get(normalizeWord(a.term)) || 0) === 1)

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
  for (const { index, term } of tokens) {
    if (index < cursor) continue;
    const reading = readings
      .filter((r) => r.start >= index && r.end <= index + term.length)
      .map((r) => r.reading)
      .filter(Boolean)
      .join(" ");
    const painted = paint(term, index);
    const content = reading ? (
      <ruby>
        <span className="term-source">{painted}</span>
        <rt aria-hidden="true">{reading}</rt>
      </ruby>
    ) : (
      painted
    );
    if (index > cursor)
      result.push(<span key={`text-${cursor}`}>{paint(text.slice(cursor, index), cursor)}</span>);
    const context = wordContext(text, index, spans, language);
    const annotation = lookup.get(term.toLocaleLowerCase("id"));
    const ready = annotation || peekMeaning(term, context, language);
    if (!ready) {
      result.push(<span key={`word-${index}`}>{content}</span>);
      cursor = index + term.length;
      continue;
    }
    const open = (anchor: HTMLElement) => {
      controller?.offer({
        term,
        language,
        reading,
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
        aria-label={term}
        data-language={language}
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
        {content}
      </button>,
    );
    cursor = index + term.length;
  }
  if (cursor < text.length)
    result.push(<span key={`text-${cursor}`}>{paint(text.slice(cursor), cursor)}</span>);
  return (
    <span
      ref={content}
      className={readings.length ? "pinyin-text" : undefined}
      lang={japanese ? "ja" : language}
    >
      {result}
    </span>
  );
}
