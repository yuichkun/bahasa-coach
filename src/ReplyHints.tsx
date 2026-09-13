import { useEffect, useRef, useState } from "react";
import type { Lesson, ReplyHint } from "../shared/types";
import { transcriptBlocks } from "../shared/transcript";
import { api } from "./api";
import { Gloss } from "./Gloss";

export function ReplyHints({ lesson, onInspect }: { lesson: Lesson; onInspect: () => void }) {
  const [enabled, setEnabled] = useState(!lesson.practice),
    [loading, setLoading] = useState(false),
    [data, setData] = useState<{ source: string; hints: ReplyHint[] } | null>(null),
    [error, setError] = useState(false),
    [cycle, setCycle] = useState(0);
  const inFlight = useRef(false),
    requested = useRef(""),
    latest = useRef(""),
    mounted = useRef(true);
  const blocks = transcriptBlocks(lesson.rows),
    coach = blocks.filter((b) => b.role === "assistant").at(-1);
  // Learner transcripts update while a hint is being read aloud. Keep its source
  // until the coach's utterance changes, including while hints are still loading.
  const source = enabled ? coach?.text.trim() || "" : "";
  latest.current = source;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!source || source === requested.current || inFlight.current) return;
    const timer = setTimeout(() => {
      inFlight.current = true;
      requested.current = source;
      setLoading(true);
      setError(false);
      void api<{ source: string; hints: ReplyHint[] }>(`/lessons/${lesson.id}/reply-hints`, {
        source,
      })
        .then((result) => {
          if (mounted.current && latest.current === source) {
            setData(result);
            if (lesson.practice && result.hints.length) onInspect();
          }
        })
        .catch(() => {
          if (mounted.current && latest.current === source) setError(true);
        })
        .finally(() => {
          inFlight.current = false;
          if (mounted.current) {
            setLoading(false);
            setCycle((n) => n + 1);
          }
        });
    }, 900);
    return () => clearTimeout(timer);
  }, [source, lesson.id, cycle]);
  if (!enabled)
    return (
      <div className="reply-hints compact">
        <button
          className="text-button"
          onClick={() => {
            requested.current = "";
            setEnabled(true);
          }}
        >
          返答のヒントを表示
        </button>
      </div>
    );
  const hints = data?.source === source ? data.hints : [];
  if (!source || (data?.source === source && !hints.length && !loading)) return null;
  return (
    <aside className="reply-hints" aria-label="返答のヒント">
      <div className="hint-heading">
        <span>返答のヒント</span>
        <button className="text-button" onClick={() => setEnabled(false)}>
          隠す
        </button>
      </div>
      {hints.length > 0 ? (
        <ol>
          {hints.map((h, i) => (
            <li key={i}>
              <p>
                <Gloss text={h.text} onInspect={onInspect} />
              </p>
              <small>{h.intent}</small>
            </li>
          ))}
        </ol>
      ) : error ? (
        <button
          className="text-button"
          onClick={() => {
            requested.current = "";
            setCycle((n) => n + 1);
          }}
        >
          取得できませんでした・再試行
        </button>
      ) : (
        <p className="hint-placeholder">
          {loading ? "返答の例を考えています…" : "相手の発言に合わせて、短い例を表示します。"}
        </p>
      )}
    </aside>
  );
}
