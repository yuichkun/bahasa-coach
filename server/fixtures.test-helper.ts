import type { TutorBackend } from "./codex.ts";
import type { Feedback, Exercise } from "../shared/types.ts";
export const exercise: Exercise = {
  title: "締め切りを相談する",
  prompt: "今週は忙しいので、締め切りを月曜日に延ばせるか相談してください。",
  context: "仕事で理由を伝える練習です。",
  focus: ["理由を伝える"],
  annotations: [],
};
export const feedback: Feedback = {
  natural: "Minggu ini aku lagi sibuk. Bisa diperpanjang sampai Senin?",
  explanation: "意図が伝わっています。親しい同僚への自然な表現です。",
  points: [
    {
      original: "saya sibuk",
      suggestion: "aku lagi sibuk",
      reason: "同僚との会話なら、この表現も使えます。",
    },
  ],
  annotations: [
    { term: "lagi", meaning: "今〜している", formal: "sedang", note: "話し言葉" },
    { term: "sibuk", meaning: "忙しい", formal: "sibuk", note: "" },
  ],
  nextFocus: ["依頼の理由を添える"],
};
export class FakeBackend implements TutorBackend {
  calls: string[] = [];
  result: unknown = exercise;
  failure: Error | null = null;
  async requestJson(prompt: string) {
    this.calls.push(prompt);
    if (this.failure) throw this.failure;
    return this.result;
  }
  async status() {
    return {
      connected: true,
      email: "test@example.invalid",
      plan: "pro",
      pending: false,
      error: null,
    };
  }
  async login() {
    return { authUrl: "https://auth.openai.com/test-only" };
  }
  async logout() {}
  async close() {}
}
