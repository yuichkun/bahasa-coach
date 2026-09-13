import type { TranslationPrecision } from "../shared/translation-settings.ts";
export interface AvailableModel {
  model: string;
  isDefault?: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts?: { reasoningEffort: string }[];
}
export function selectTranslationModel(models: AvailableModel[], precision: TranslationPrecision) {
  const fallback = models.find((m) => m.isDefault) || models[0];
  if (!fallback)
    throw new Error("利用できる文章モデルを取得できませんでした。再接続してください。");
  const model =
    precision === "fast"
      ? models.find((m) => m.model === "gpt-5.3-codex-spark") ||
        models.find((m) => m.model === "gpt-5.6-luna") ||
        fallback
      : fallback;
  const preferred =
    precision === "precise"
      ? ["medium", "high", "low"]
      : precision === "fast"
        ? ["none", "minimal", "low"]
        : ["low", "minimal", "none"];
  const effort =
    preferred.find((e) => model.supportedReasoningEfforts?.some((s) => s.reasoningEffort === e)) ||
    model.defaultReasoningEffort;
  return { model, effort };
}
