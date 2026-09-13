import { sentenceRequest, translationSpans, type TranslationContext } from "../shared/translation";
import { Gloss } from "./Gloss";
import { SentenceMeaning } from "./SentenceMeaning";

export function CaptionText({
  text,
  context,
  streaming,
  prefetch,
  onOpen,
  onInspect,
}: {
  text: string;
  context: TranslationContext;
  streaming: boolean;
  prefetch: boolean;
  onOpen: () => void;
  onInspect: () => void;
}) {
  const spans = translationSpans(text);
  const rows: { start: number; end: number; translate: boolean }[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (text.slice(cursor, span.start).trim())
      rows.push({ start: cursor, end: span.start, translate: false });
    rows.push({ ...span, translate: true });
    cursor = span.end;
  }
  if (text.slice(cursor).trim()) rows.push({ start: cursor, end: text.length, translate: false });
  return (
    <>
      {rows.map((row) => {
        const request = row.translate ? sentenceRequest(text, row.start, context) : null;
        return (
          <div className="caption-sentence" key={row.start}>
            <p className="caption-text" dir="auto">
              <Gloss
                text={text.slice(row.start, row.end)}
                streaming={streaming}
                prefetch={prefetch}
                onOpen={onOpen}
                onInspect={onInspect}
              />
            </p>
            {request && <SentenceMeaning request={request} streaming={streaming} />}
          </div>
        );
      })}
    </>
  );
}
