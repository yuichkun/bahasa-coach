import { useId, useState } from "react";
import type { Annotation } from "../shared/types";
function Term({ text, annotation }: { text: string; annotation: Annotation }) {
  const id = useId(),
    [open, setOpen] = useState(false);
  return (
    <span
      className="term-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="term"
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {text}
      </button>
      {open && (
        <span id={id} role="tooltip" className="gloss">
          <strong>{text}</strong>
          <span>{annotation.meaning}</span>
          <span className="formal">
            正式形 <b>{annotation.formal || annotation.term}</b>
          </span>
          {annotation.note && <small>{annotation.note}</small>}
        </span>
      )}
    </span>
  );
}
export function Gloss({ text, annotations = [] }: { text: string; annotations?: Annotation[] }) {
  const lookup = new Map(
    annotations
      .filter((a) => /[A-Za-z]/.test(a.term))
      .map((a) => [a.term.toLocaleLowerCase("id"), a]),
  );
  if (!lookup.size) return <>{text}</>;
  const terms = [...lookup.keys()]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![A-Za-z])(${terms.join("|")})(?![A-Za-z])`, "giu");
  return (
    <>
      {text.split(pattern).map((part, i) => {
        const a = lookup.get(part.toLocaleLowerCase("id"));
        return a ? <Term key={i} text={part} annotation={a} /> : <span key={i}>{part}</span>;
      })}
    </>
  );
}
