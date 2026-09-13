import { z } from "zod";
export const translationPrecisionSchema = z.enum(["fast", "balanced", "precise"]);
export type TranslationPrecision = z.infer<typeof translationPrecisionSchema>;
export const DEFAULT_TRANSLATION_PRECISION: TranslationPrecision = "fast";
export const TRANSLATION_PRECISIONS = [
  { value: "fast", label: "速さ優先", description: "会話のテンポを優先して、訳を早く表示します。" },
  {
    value: "balanced",
    label: "バランス",
    description: "速さと、細かな意味の読み取りを両立します。",
  },
  {
    value: "precise",
    label: "精度優先",
    description: "含みや言い回しを丁寧に確認します。表示までの時間は長くなります。",
  },
] as const;
