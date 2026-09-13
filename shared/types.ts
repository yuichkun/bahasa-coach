import { z } from "zod";
import type { GlossUpdate } from "./glossary.ts";
import type { RecapState } from "./recap.ts";
import type { TranslationPrecision } from "./translation-settings.ts";
import type { Language, Direction } from "./languages.ts";
export type { Direction } from "./languages.ts";

export const annotationSchema = z.object({
  term: z.string(),
  meaning: z.string(),
  formal: z.string(),
  note: z.string(),
});
export const exerciseSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  context: z.string(),
  focus: z.array(z.string()),
  annotations: z.array(annotationSchema),
});
export const feedbackSchema = z.object({
  natural: z.string(),
  explanation: z.string(),
  points: z
    .array(z.object({ original: z.string(), suggestion: z.string(), reason: z.string() }))
    .max(3),
  annotations: z.array(annotationSchema),
  nextFocus: z.array(z.string()),
});
export const correctionSchema = z.object({ corrected: z.string(), explanation: z.string() });
export const practiceCheckSchema = z.object({
  outcome: z.enum(["pass", "retry", "uncertain"]),
  evidence: z.string(),
  explanation: z.string(),
});
export type PracticeCheck = z.infer<typeof practiceCheckSchema> & { assisted?: boolean };
export const replyHintsSchema = z.object({
  hints: z.array(z.object({ text: z.string(), intent: z.string() })).max(3),
});
export type ReplyHint = z.infer<typeof replyHintsSchema>["hints"][number];
export const speechFeedbackSchema = z.object({
  outcome: z.enum(["correction", "clear", "uncertain"]),
  original: z.string(),
  natural: z.string(),
  explanation: z.string(),
  annotations: z.array(annotationSchema),
});
export interface SpeechFeedback {
  blockId: string;
  source: string;
  result: z.infer<typeof speechFeedbackSchema> | null;
  status: "pending" | "ready" | "error";
}
export interface PracticeFocus {
  id: string;
  sourceLessonId: string;
  original: string;
  suggestion: string;
  reason: string;
  state: "proposed" | "practicing" | "transfer_due" | "transferred" | "withdrawn";
}
export interface PracticeContext {
  focus: PracticeFocus;
  mode: "retry" | "transfer";
  hintUsed: boolean;
  check: PracticeCheck | null;
}
export type Annotation = z.infer<typeof annotationSchema>;
export type Exercise = z.infer<typeof exerciseSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type Kind = "voice" | "writing";
export interface TranscriptRow {
  id: string;
  role: "user" | "assistant";
  original: string;
  corrected: string | null;
  revisionStale: boolean;
  startMs: number;
  endMs: number;
}
export interface Lesson {
  id: string;
  language?: Language;
  kind: Kind;
  direction: Direction;
  topic: string;
  title: string;
  exercise: Exercise | null;
  draft: string;
  status: "draft" | "active" | "paused" | "completed" | "interrupted";
  createdAt: number;
  updatedAt: number;
  rows: TranscriptRow[];
  attempts: Attempt[];
  speechFeedback?: SpeechFeedback[];
  recap?: RecapState | null;
  voiceSeconds?: number;
  review?: {
    status: "ready" | "clear" | "uncertain" | "stale";
    focus: PracticeFocus | null;
  } | null;
  practice?: PracticeContext | null;
}
export interface Attempt {
  id: string;
  answer: string;
  feedback: Feedback;
  createdAt: number;
}
export interface LiveInfo {
  lessonId: string;
  sessionId: string | null;
  owner: string;
  status: "connecting" | "active" | "closing";
  seconds: number;
  startedAt: number;
  baseSeconds?: number;
}
export interface AppStatus {
  translation?: { precision: TranslationPrecision };
  chatgpt: {
    connected: boolean;
    email: string | null;
    plan: string | null;
    pending: boolean;
    error: string | null;
  };
  voice: {
    configured: boolean;
    active: LiveInfo | null;
    monthSeconds: number;
    unconfirmed: number;
    pricePerMinute: number;
  };
}
export type AppEvent =
  | ({ type: "glossary" } & GlossUpdate)
  | { type: "lesson"; lesson: Lesson }
  | { type: "status"; status: AppStatus }
  | { type: "live"; event: Record<string, unknown>; lessonId: string }
  | { type: "notice"; message: string };
export const TOPICS = ["仕事の説明", "意見と理由", "依頼", "断り方", "代案"];
export function voiceCost(seconds: number) {
  return (seconds / 60) * 0.05;
}
