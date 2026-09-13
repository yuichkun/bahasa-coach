import { z } from "zod";

const turnSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(1500) });
export const translationRequestSchema = z.object({
  sentence: z.string().trim().min(1).max(8000),
  speaker: z.enum(["user", "assistant"]),
  before: z.array(turnSchema).max(3),
  after: z.array(turnSchema).max(3),
});
export type TranslationRequest = z.infer<typeof translationRequestSchema>;
export type TranslationTurn = TranslationRequest["before"][number];
export interface TranslationContext {
  speaker: TranslationRequest["speaker"];
  before: TranslationTurn[];
  after: TranslationTurn[];
}
export interface TranslationEntry {
  key: string;
  translation: string;
}
const segmenter = new Intl.Segmenter("id", { granularity: "sentence" });
export function translationSpans(text: string) {
  return [...segmenter.segment(text)]
    .filter((part) => /[\p{Script=Latin}]/u.test(part.segment))
    .map((part) => ({
      text: part.segment.trim(),
      start: part.index,
      end: part.index + part.segment.length,
      complete: /[.!?。！？][\s"'”’)]*$/.test(part.segment),
    }));
}
export function sentenceRequest(
  text: string,
  index: number,
  context: TranslationContext,
): TranslationRequest | null {
  const span = translationSpans(text).find((s) => index >= s.start && index < s.end);
  if (!span || span.text.length > 8000) return null;
  const before = [...context.before];
  const after = [...context.after];
  if (text.slice(0, span.start).trim())
    before.push({ role: context.speaker, text: text.slice(0, span.start).trim() });
  if (text.slice(span.end).trim())
    after.unshift({ role: context.speaker, text: text.slice(span.end).trim() });
  return {
    sentence: span.text,
    speaker: context.speaker,
    before: before.slice(-3).map((t) => ({ role: t.role, text: t.text.slice(-1500) })),
    after: after.slice(0, 3).map((t) => ({ role: t.role, text: t.text.slice(0, 1500) })),
  };
}
export function translationKey(request: TranslationRequest) {
  const clean = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const turns = (items: TranslationTurn[]) =>
    items.map((t) => ({ role: t.role, text: clean(t.text) }));
  // Retain punctuation, case, speaker and surrounding context: questions and
  // pronoun referents must not share a cache entry just because words match.
  return (
    "sentence-v1:" +
    JSON.stringify({
      sentence: clean(request.sentence),
      speaker: request.speaker,
      before: turns(request.before),
      after: turns(request.after),
    })
  );
}
