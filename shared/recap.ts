import { z } from "zod";
import { annotationSchema } from "./types.ts";

export const recapPointSchema = z.object({
  kind: z.enum(["worked", "adjust", "expression"]),
  title: z.string(),
  sourceId: z.string(),
  quote: z.string(),
  natural: z.string(),
  originalFocus: z.string(),
  focus: z.string(),
  explanation: z.string(),
  examples: z.array(z.object({ text: z.string(), meaning: z.string() })),
  annotations: z.array(annotationSchema),
});
export const recapSchema = z.object({
  title: z.string(),
  introduction: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      sourceIds: z.array(z.string()),
      points: z.array(recapPointSchema),
    }),
  ),
  next: z.object({ title: z.string(), prompt: z.string(), reason: z.string() }),
  closing: z.string(),
});
export type Recap = z.infer<typeof recapSchema>;
export type RecapPoint = z.infer<typeof recapPointSchema>;
export const RECAP_TIMEOUT_MS = 5 * 60_000;
export type RecapStage = "queued" | "generating" | "validating";
export interface RecapProgress {
  stage: RecapStage;
  startedAt: number;
  updatedAt: number;
  deadlineAt: number;
  attempt: number;
  receivedChars: number;
}
export interface RecapState {
  status: "pending" | "ready" | "error";
  data: Recap | null;
  error: string | null;
  progress?: RecapProgress;
  errorId?: string;
}
