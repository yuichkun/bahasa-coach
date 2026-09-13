import type { Annotation } from "./types.ts";
import { languageKey, type Language } from "./languages.ts";

export type GlossValue = Annotation & { scope: "context" | "general" };
export interface GlossRequest {
  term: string;
  context: string;
  language?: Language;
}
export interface GlossEntry extends GlossRequest {
  annotation: Annotation;
}
export interface GlossUpdate {
  language?: Language;
  entries: GlossEntry[];
  vocabulary: Annotation[];
  pending?: string[];
  failed?: string[];
}
export const WORD_PATTERN = /[\p{Script=Latin}\p{M}]+(?:[-’'][\p{Script=Latin}\p{M}]+)*/gu;
const chineseWords = new Intl.Segmenter("zh-Hans", { granularity: "word" });
export function words(text: string, language: Language = "id") {
  if (language === "zh-Hans") {
    // Kana-bearing runs are Japanese. Do not annotate their kanji as Mandarin.
    // Keep original UTF-16 offsets so source quotes and highlights stay unchanged.
    return [...text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{M}ー]+/gu)]
      .filter((run) => !/[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(run[0]))
      .flatMap((run) =>
        [...chineseWords.segment(run[0])]
          .filter((part) => part.isWordLike && /\p{Script=Han}/u.test(part.segment))
          .map((part) => ({ term: part.segment, index: run.index + part.index })),
      );
  }
  return [...text.matchAll(WORD_PATTERN)].map((m) => ({ term: m[0], index: m.index }));
}
export function hasTargetText(text: string, language: Language = "id") {
  return words(text, language).length > 0;
}
export function normalizeWord(term: string) {
  return term.normalize("NFKC").toLocaleLowerCase("id").replace(/’/g, "'");
}
export function normalizeContext(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("id")
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .trim();
}
export function glossKey(term: string, context: string, language: Language = "id") {
  return languageKey(language, normalizeWord(term) + "\n" + normalizeContext(context));
}
const segmenters = Object.fromEntries(
  ["id", "zh-Hans", "en"].map((language) => [
    language,
    new Intl.Segmenter(language, { granularity: "sentence" }),
  ]),
);
export function sentenceContexts(text: string, language: Language = "id") {
  // Stable completed sentences keep their keys when more speech arrives afterwards.
  const spans: { text: string; start: number; end: number; complete: boolean }[] = [];
  for (const part of segmenters[language].segment(text)) {
    const tokens = words(part.segment, language);
    if (!tokens.length) continue;
    // Bound unusually long, unpunctuated speech without cutting individual words.
    for (let i = 0; i < tokens.length; i += 28) {
      const start = part.index + (i === 0 ? 0 : tokens[i].index);
      const end = part.index + (tokens[i + 28]?.index ?? part.segment.length);
      spans.push({
        text: text.slice(start, end).trim(),
        start,
        end,
        complete: i + 28 < tokens.length || /[.!?。！？][\s"'”’)]*$/.test(text.slice(start, end)),
      });
    }
  }
  return spans;
}
export function selectionContext(
  text: string,
  term: string,
  index: number,
  language: Language = "id",
) {
  if (words(text, language).filter((w) => normalizeWord(w.term) === normalizeWord(term)).length > 1)
    return (
      text.slice(0, index) +
      "⟦" +
      text.slice(index, index + term.length) +
      "⟧" +
      text.slice(index + term.length)
    ).trim();
  return text.trim();
}
export function wordContext(
  text: string,
  index: number,
  spans = sentenceContexts(text),
  language: Language = "id",
) {
  const span = spans.find((s) => index >= s.start && index < s.end);
  if (!span) return text.slice(Math.max(0, index - 120), index + 200).trim();
  const raw = text.slice(span.start, span.end),
    local = index - span.start;
  const term = words(raw, language).find((w) => w.index === local)?.term;
  return term ? selectionContext(raw, term, local, language) : span.text;
}

// Basic dictionary meanings, not a guess at the meaning in a new sentence.
// Ambiguous entries still receive contextual prefetching (bisa: ability / venom).
const basic: [string, string, string, boolean][] = [
  ["aku", "私", "saya", true],
  ["saya", "私", "saya", true],
  ["kamu", "あなた", "Anda", true],
  ["kita", "私たち（相手を含む）", "kita", true],
  ["kami", "私たち（相手を含まない）", "kami", true],
  ["dia", "彼・彼女", "dia", true],
  ["mereka", "彼ら・彼女ら", "mereka", true],
  ["ngerti", "分かる、理解する", "mengerti", true],
  ["ngobrol", "おしゃべりする", "berbincang-bincang", true],
  ["ngomong", "話す、言う", "berbicara", true],
  ["pengen", "〜したい、欲しい", "ingin", true],
  ["pengin", "〜したい、欲しい", "ingin", true],
  ["banget", "とても、すごく", "sangat", true],
  ["makasih", "ありがとう", "terima kasih", true],
  ["bentar", "少しの間", "sebentar", true],
  ["dikit", "少し", "sedikit", true],
  ["gimana", "どのように、どう", "bagaimana", true],
  ["gitu", "そのように", "begitu", true],
  ["gini", "このように", "begini", true],
  ["udah", "もう〜した", "sudah", true],
  ["sudah", "もう〜した", "sudah", true],
  ["belum", "まだ〜していない", "belum", true],
  ["dan", "〜と、そして", "dan", true],
  ["atau", "または", "atau", true],
  ["tapi", "でも、しかし", "tetapi", true],
  ["tetapi", "しかし", "tetapi", true],
  ["karena", "〜だから、〜のために", "karena", true],
  ["bisa", "できる／（蛇などの）毒", "bisa", false],
  ["lagi", "いま〜している／また、さらに", "sedang / lagi", false],
  ["baru", "新しい／〜したばかり", "baru", false],
  ["mau", "〜したい／〜するつもり", "ingin / akan", false],
];
export const BASIC_GLOSSES = new Map(
  basic.map(([term, meaning, formal, stable]) => [
    term,
    { annotation: { term, meaning, formal, note: "" }, stable },
  ]),
);
export function basicGloss(term: string, language: Language = "id") {
  return language === "id" ? BASIC_GLOSSES.get(normalizeWord(term)) : undefined;
}
