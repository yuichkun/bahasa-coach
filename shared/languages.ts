import { z } from "zod";

export const languageSchema = z.enum(["id", "zh-Hans", "en"]);
export type Language = z.infer<typeof languageSchema>;
export const LANGUAGES = languageSchema.options;
export const LANGUAGE = {
  id: {
    label: "インドネシア語",
    target: "Indonesian",
    coach: "Rani",
    description: "バンドンで暮らす、架空の会話パートナー",
    register:
      "Teach natural, moderately informal Indonesian. Do not mechanically strip meN-/meng- prefixes. Accept valid colloquial forms and label strong or regional slang. Show the formal equivalent when useful.",
  },
  "zh-Hans": {
    label: "中国語（簡体字）",
    target: "Mandarin Chinese (普通话), written in Simplified Chinese (简体字)",
    coach: "林悦",
    description: "上海で暮らす、架空の会話パートナー。普通話で話します。",
    register:
      "Teach natural contemporary Mandarin for everyday adult conversations. Write Chinese examples and model answers in Simplified Chinese, never replace them with pinyin. Explain word order, particles, measure words and politeness in Japanese when useful. Accept natural variants; do not force literary forms. The UI adds tone-marked pinyin separately. Never assess actual pronunciation or tones from a transcript. Preserve verbatim source quotations, including traditional characters and recognition errors.",
  },
  en: {
    label: "英語",
    target: "English",
    coach: "Alex",
    description: "シアトルで暮らす、架空の会話パートナー",
    register:
      "Teach natural contemporary English for everyday and work conversations. Accept standard American and British variants, natural contractions and appropriate informal expressions. Explain register and politeness in Japanese. Offer a neutral or more formal equivalent only when useful; do not mechanically expand every contraction or overcorrect valid dialects. Adjust complexity to the learner's actual replies, without assuming advanced proficiency.",
  },
} as const;

export function languageOf(lesson: { language?: Language } | null | undefined): Language {
  return lesson?.language ?? "id";
}
export const directionSchema = z.enum(["ja-id", "id-ja", "ja-zh", "zh-ja", "ja-en", "en-ja"]);
export type Direction = z.infer<typeof directionSchema>;
export function directionLanguage(direction: Direction): Language {
  return direction.includes("zh") ? "zh-Hans" : direction.includes("en") ? "en" : "id";
}
export function directionFor(language: Language, toJapanese = false): Direction {
  const code = language === "zh-Hans" ? "zh" : language;
  return (toJapanese ? `${code}-ja` : `ja-${code}`) as Direction;
}
export function languageKey(language: Language, key: string) {
  // Keep old Indonesian caches readable; other languages have explicit namespaces.
  return language === "id" ? key : `${language}:${key}`;
}
