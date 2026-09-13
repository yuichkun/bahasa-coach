import { useEffect, useRef } from "react";
import type { Lesson } from "../shared/types";
import { recapSchema } from "../shared/recap";
import { api } from "./api";
import { errorMessage, reportError } from "../shared/errors";

export function validateRecapLesson(lesson: Lesson, id: string): Lesson {
  if (
    lesson?.id !== id ||
    !lesson.recap ||
    !["pending", "ready", "error"].includes(lesson.recap.status)
  )
    throw new Error("サーバーから有効なノートの状態を取得できませんでした。");
  if (lesson.recap.status === "ready") recapSchema.parse(lesson.recap.data);
  if (lesson.recap.status === "error" && !lesson.recap.error)
    throw new Error("ノートの生成は失敗しましたが、原因が記録されていません。");
  return lesson;
}

// WebSocket notifications improve latency; the read endpoint remains authoritative.
export function useRecapSync({
  id,
  enabled,
  connected,
  onLesson,
  onError,
}: {
  id: string;
  enabled: boolean;
  connected: boolean;
  onLesson: (lesson: Lesson) => void;
  onError: (message: string) => void;
}) {
  const callbacks = useRef({ onLesson, onError });
  callbacks.current = { onLesson, onError };
  useEffect(() => {
    if (!enabled || !id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const check = async () => {
      try {
        const lesson = validateRecapLesson(
          await api<Lesson>(`/lessons/${id}/recap`, undefined, "GET", {
            signal: controller.signal,
            timeoutMs: 10_000,
          }),
          id,
        );
        if (!alive) return;
        callbacks.current.onLesson(lesson);
        if (lesson.recap?.status === "pending") timer = setTimeout(() => void check(), 2000);
      } catch (error) {
        if (!alive) return;
        reportError(`recap.sync:${id}`, error);
        callbacks.current.onError(`ノートの状態を確認できません。${errorMessage(error)}`);
      }
    };
    void check();
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, enabled, connected]);
}
