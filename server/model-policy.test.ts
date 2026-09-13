import { expect, it } from "vite-plus/test";
import { selectTranslationModel, type AvailableModel } from "./model-policy.ts";
const models: AvailableModel[] = [
  {
    model: "gpt-5.6-sol",
    isDefault: true,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "medium" },
      { reasoningEffort: "high" },
    ],
  },
  {
    model: "gpt-5.6-luna",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }],
  },
  {
    model: "gpt-5.3-codex-spark",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
  },
];
it("maps user-facing precision levels to available models and supported efforts", () => {
  expect(selectTranslationModel(models, "fast").effort).toBe("low");
  expect(selectTranslationModel(models, "balanced")).toEqual({ model: models[0], effort: "low" });
  expect(selectTranslationModel(models, "precise")).toEqual({ model: models[0], effort: "medium" });
});
it("stays within the account catalog when a preferred model or effort is unavailable", () => {
  const only = {
    model: "account-model",
    isDefault: true,
    defaultReasoningEffort: "minimal",
    supportedReasoningEfforts: [{ reasoningEffort: "minimal" }],
  };
  expect(selectTranslationModel([only], "fast")).toEqual({ model: only, effort: "minimal" });
  expect(selectTranslationModel([only], "precise")).toEqual({ model: only, effort: "minimal" });
  expect(() => selectTranslationModel([], "fast")).toThrow("利用できる");
});
