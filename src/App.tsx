import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  TOPICS,
  voiceCost,
  type AppEvent,
  type AppStatus,
  type Direction,
  type Lesson,
  type PracticeFocus,
} from "../shared/types";
import { api } from "./api";
import { VoiceClient } from "./voice";
import { Gloss } from "./Gloss";
import { ingestGlossary, resumeGlossaryPrefetch } from "./glossary-cache";
import { transcriptBlocks } from "../shared/transcript";
import { LearningLoop } from "./LearningLoop";
import { ReplyHints } from "./ReplyHints";
import { SpeechNote } from "./SpeechNote";
import { MicControl } from "./MicControl";
import { TranslationSettings } from "./TranslationSettings";
import { DEFAULT_TRANSLATION_PRECISION } from "../shared/translation-settings";
import { CaptionText } from "./CaptionText";
import { COACH_NAME, COACH_DESCRIPTION } from "../shared/coach";
import { RecapPage } from "./RecapPage";

type View = "voice" | "writing" | "history" | "settings" | "recap";
const labels: Record<View, string> = {
  voice: "会話",
  writing: "作文",
  history: "履歴",
  settings: "接続設定",
  recap: "レッスンノート",
};
const icons: Record<string, React.ReactNode> = {
  voice: (
    <>
      <path d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Z" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
    </>
  ),
  writing: (
    <>
      <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </>
  ),
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

export default function App() {
  const [view, setViewState] = useState<View>("voice"),
    [recapLesson, setRecapLesson] = useState<Lesson | null>(null),
    [recapError, setRecapError] = useState(""),
    [attachedVoiceId, setAttachedVoiceId] = useState(""),
    [status, setStatus] = useState<AppStatus | null>(null),
    [voice, setVoice] = useState<Lesson | null>(null),
    [writing, setWriting] = useState<Lesson | null>(null),
    [history, setHistory] = useState<Lesson[]>([]);
  const [topic, setTopic] = useState(TOPICS[0]),
    [direction, setDirection] = useState<Direction>("ja-id"),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [saved, setSaved] = useState(""),
    [key, setKey] = useState(""),
    [connecting, setConnecting] = useState(false),
    [stopUnconfirmed, setStopUnconfirmed] = useState(false),
    [connectedEvents, setConnectedEvents] = useState(false),
    [search, setSearch] = useState(""),
    [follow, setFollow] = useState(true),
    [currentSeconds, setCurrentSeconds] = useState(0),
    [hintText, setHintText] = useState("");
  const recapId = useRef("");
  const sessionLessonId = useRef("");
  const assisted = useRef(new Set<string>());
  const helpRequests = useRef(new Map<string, Promise<unknown>>());
  const owner = useRef(crypto.randomUUID()),
    socket = useRef<WebSocket | null>(null),
    voiceClient = useRef<VoiceClient | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    captionArea = useRef<HTMLDivElement | null>(null),
    currentVoice = useRef<Lesson | null>(null),
    currentWriting = useRef<Lesson | null>(null),
    reviews = useRef(new Map<string, Promise<void>>()),
    attempts = useRef(new Map<string, string>());
  currentVoice.current = voice;
  currentWriting.current = writing;
  function setView(next: View) {
    if (next !== "recap") window.history.pushState(null, "", `#/${next}`);
    setViewState(next);
  }
  async function openRecap(id: string, retry = false) {
    if (sessionLessonId.current) {
      setNotice("会話を終了してから、レッスンノートを開いてください。");
      window.history.replaceState(null, "", "#/voice");
      setViewState("voice");
      return;
    }
    setRecapError("");
    recapId.current = id;
    setViewState("recap");
    const route = `#/recap/${encodeURIComponent(id)}`;
    if (location.hash !== route) window.history.pushState(null, "", route);
    setRecapLesson((prior) =>
      prior?.id === id ? prior : currentVoice.current?.id === id ? currentVoice.current : null,
    );
    try {
      const lesson = await api<Lesson>(`/lessons/${id}/recap`, { retry });
      if (recapId.current === id) setRecapLesson(lesson);
      updateLesson(lesson);
    } catch (error) {
      if (recapId.current === id) setRecapError((error as Error).message);
    }
  }
  useEffect(() => {
    const route = () => {
      const match = location.hash.match(/^#\/recap\/(.+)$/);
      if (match) void openRecap(decodeURIComponent(match[1]));
      else if (["#/voice", "#/writing", "#/history", "#/settings"].includes(location.hash))
        setViewState(location.hash.slice(2) as View);
    };
    route();
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    return () => {
      window.removeEventListener("hashchange", route);
      window.removeEventListener("popstate", route);
    };
  }, []);
  const refresh = useCallback(async () => {
    try {
      setStatus(await api<AppStatus>("/status"));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, []);
  function updateLesson(l: Lesson) {
    if (l.id === recapId.current) setRecapLesson(l);
    setHistory((items) => [l, ...items.filter((i) => i.id !== l.id)]);
    if (l.kind === "voice" && (!currentVoice.current || currentVoice.current.id === l.id))
      setVoice(l);
    if (l.kind === "writing" && currentWriting.current?.id === l.id) setWriting(l);
  }
  async function reviewVoice(id: string, force = false) {
    if (force) {
      reviews.current.delete(id);
      attempts.current.delete(id);
    }
    if (reviews.current.has(id)) return reviews.current.get(id);
    const job = (async () => {
      await helpRequests.current.get(id);
      const l = await api<Lesson>(`/lessons/${id}`);
      updateLesson(l);
      if (!l.rows.some((r) => r.role === "user") || (!force && (l.review || l.practice?.check)))
        return;
      setBusy("review");
      const requestId = attempts.current.get(id) || crypto.randomUUID();
      attempts.current.set(id, requestId);
      try {
        updateLesson(await api<Lesson>(`/lessons/${id}/evaluate`, { requestId, answer: "" }));
      } finally {
        setBusy("");
      }
    })();
    reviews.current.set(id, job);
    try {
      await job;
    } catch (e) {
      reviews.current.delete(id);
      setNotice((e as Error).message);
    }
  }
  const handler = useRef<(event: AppEvent) => void>(() => {});
  handler.current = (event) => {
    if (event.type === "glossary") ingestGlossary(event);
    if (event.type === "lesson") updateLesson(event.lesson);
    if (event.type === "status") setStatus(event.status);
    if (event.type === "notice") setNotice(event.message);
    if (event.type === "live") {
      if (event.event.type === "session.started") {
        setConnecting(false);
        void refresh();
      }
      if (event.event.type === "session.usage.updated") {
        const u = event.event.usage as { seconds: number };
        if (u) setCurrentSeconds(Number(event.event.totalSeconds ?? u.seconds));
      }
      if (event.event.type === "session.closed" || event.event.type === "local.closed") {
        sessionLessonId.current = "";
        setStopUnconfirmed(false);
        if (!event.event.paused) setAttachedVoiceId("");
        voiceClient.current?.cleanup();
        setConnecting(false);
        const u = event.event.usage as { seconds?: number };
        if (u?.seconds != null) setCurrentSeconds(Number(event.event.totalSeconds ?? u.seconds));
        void refresh();
        if (!event.event.paused) {
          void openRecap(event.lessonId);
          if (currentVoice.current?.practice) void reviewVoice(event.lessonId);
        }
      }
      if (event.event.type === "error") {
        const err = event.event.error as { message?: string };
        setNotice(err?.message || "音声 API でエラーが発生しました。");
      }
    }
  };
  useEffect(() => {
    let stopped = false,
      retry: ReturnType<typeof setTimeout>;
    function connect() {
      if (stopped) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/events?client=${owner.current}`,
      );
      socket.current = ws;
      ws.onopen = () => {
        setConnectedEvents(true);
        resumeGlossaryPrefetch();
      };
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data));
        } catch {}
      };
      ws.onclose = () => {
        setConnectedEvents(false);
        if (!stopped) {
          sessionLessonId.current = "";
          voiceClient.current?.cleanup();
          setConnecting(false);
          retry = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => {};
    }
    connect();
    void refresh();
    void api<Lesson[]>("/lessons").then((items) => {
      setHistory(items);
      const paused = items.find(
        (l) => l.id === localStorage.getItem("bahasa.voice") && l.status === "paused",
      );
      if (paused) {
        setCurrentSeconds(paused.voiceSeconds || 0);
        setVoice(paused);
        setAttachedVoiceId(paused.id);
      }
      const id = localStorage.getItem("bahasa.writing");
      const l = items.find((i) => i.id === id);
      if (l) {
        try {
          const draft = JSON.parse(localStorage.getItem(`bahasa.draft.${id}`) || "null");
          if (draft && draft.updatedAt > l.updatedAt) l.draft = draft.text;
        } catch {}
        setWriting(l);
      }
    });
    const timer = setInterval(() => void refresh(), 5000);
    const unload = () => {
      navigator.sendBeacon(
        "/api/live/stop",
        new Blob([JSON.stringify({ owner: owner.current })], { type: "application/json" }),
      );
      voiceClient.current?.cleanup();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(timer);
      window.removeEventListener("beforeunload", unload);
      socket.current?.close();
      voiceClient.current?.cleanup();
    };
  }, [refresh]);
  useEffect(() => {
    if (!writing) return;
    const { id, draft } = writing;
    localStorage.setItem("bahasa.writing", id);
    setSaved("保存中…");
    const timer = setTimeout(() => {
      void api(`/lessons/${id}/draft`, { draft }, "PUT")
        .then(() => {
          if (currentWriting.current?.id === id && currentWriting.current.draft === draft) {
            setSaved("保存済み");
            localStorage.removeItem(`bahasa.draft.${id}`);
          }
        })
        .catch(() => setSaved("未同期・このブラウザに下書きを保持しています"));
    }, 500);
    return () => clearTimeout(timer);
  }, [writing?.id, writing?.draft]);
  useEffect(() => {
    if (follow && captionArea.current)
      captionArea.current.scrollTop = captionArea.current.scrollHeight;
  }, [voice?.rows, follow, view]);
  useEffect(() => {
    const area = captionArea.current;
    if (!area || !follow) return;
    const observer = new MutationObserver(() => {
      area.scrollTop = area.scrollHeight;
    });
    observer.observe(area, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [follow, view]);

  const active = status?.voice.active,
    owns = active?.owner === owner.current,
    running = Boolean(active) || connecting,
    paused = !running && voice?.status === "paused";
  // Session.started and the status response arrive independently. Keep the same
  // microphone mounted between them so reconnecting does not move keyboard focus.
  const showMic = running || paused || (voice?.status === "active" && attachedVoiceId === voice.id);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(
      () =>
        setCurrentSeconds(
          Math.max(
            active.seconds,
            (active.baseSeconds || 0) + (Date.now() - active.startedAt) / 1000,
          ),
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [active?.lessonId, active?.startedAt, active?.seconds]);
  async function perform(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function newExercise(kind: "voice" | "writing") {
    setHintText("");
    await perform("exercise", async () => {
      const l = await api<Lesson>("/lessons", { kind, direction, topic });
      if (kind === "voice") {
        currentVoice.current = l;
        setVoice(l);
        setCurrentSeconds(0);
      } else {
        currentWriting.current = l;
        setWriting(l);
      }
      setHistory((items) => [l, ...items.filter((i) => i.id !== l.id)]);
      updateLesson(await api<Lesson>(`/lessons/${l.id}/exercise`, {}));
    });
  }
  async function start(selected = currentVoice.current) {
    if (!audio.current) return;
    setNotice("");
    setConnecting(true);
    setStopUnconfirmed(false);
    setCurrentSeconds(selected?.status === "paused" ? selected.voiceSeconds || 0 : 0);
    if (selected?.status !== "paused") setHintText("");
    const client = new VoiceClient(owner.current, audio.current);
    voiceClient.current = client;
    try {
      let lesson = selected && ["draft", "paused"].includes(selected.status) ? selected : null;
      if (!lesson)
        lesson = await api<Lesson>("/lessons", {
          kind: "voice",
          direction: "ja-id",
          topic: "自由会話",
        });
      if (lesson.practice && !lesson.exercise)
        lesson = await api<Lesson>(`/lessons/${lesson.id}/exercise`, {});
      currentVoice.current = lesson;
      sessionLessonId.current = lesson.id;
      setAttachedVoiceId(lesson.id);
      localStorage.setItem("bahasa.voice", lesson.id);
      setVoice(lesson);
      setFollow(true);
      await client.start(
        lesson.id,
        (event) => {
          if (socket.current?.readyState === WebSocket.OPEN)
            socket.current.send(JSON.stringify({ type: "live.event", event }));
        },
        setNotice,
      );
      await refresh();
    } catch (e) {
      sessionLessonId.current = "";
      setNotice((e as Error).message);
      setConnecting(false);
      await refresh();
    }
  }
  function inspect(lesson: Lesson | null) {
    setFollow(false);
    recordAssistance(lesson);
  }
  function recordAssistance(lesson: Lesson | null) {
    if (lesson?.practice && !assisted.current.has(lesson.id)) {
      assisted.current.add(lesson.id);
      const request = api(`/lessons/${lesson.id}/assistance`, {});
      helpRequests.current.set(lesson.id, request);
      void request.catch(() => {
        assisted.current.delete(lesson.id);
        setNotice("ヒントの利用記録を保存できませんでした。確認前に再試行してください。");
      });
    }
  }
  async function beginPractice(
    focus: PracticeFocus,
    mode: "retry" | "transfer",
    kind: "voice" | "writing",
  ) {
    await perform("exercise", async () => {
      const l = await api<Lesson>("/practice", { focusId: focus.id, mode, kind });
      setHintText("");
      setView(kind);
      if (kind === "voice") {
        currentVoice.current = l;
        setVoice(l);
      } else {
        currentWriting.current = l;
        setWriting(l);
      }
      const ready = await api<Lesson>(`/lessons/${l.id}/exercise`, {});
      updateLesson(ready);
      if (kind === "voice") await start(ready);
    });
  }
  async function showHint(lesson: Lesson) {
    await perform("hint", async () => {
      const result = await api<{ hint: string; lesson: Lesson }>(`/lessons/${lesson.id}/hint`, {});
      setHintText(result.hint);
      updateLesson(result.lesson);
    });
  }
  async function stop() {
    await perform("stop", async () => {
      const lesson = currentVoice.current;
      if (lesson?.status === "paused")
        updateLesson(await api<Lesson>(`/lessons/${lesson.id}/finish`, {}));
      else await voiceClient.current?.stop();
      sessionLessonId.current = "";
      setAttachedVoiceId("");
      if (lesson) void openRecap(lesson.id);
      setConnecting(false);
      await refresh();
      if (voice?.practice) await reviewVoice(voice.id);
    });
  }
  async function pause() {
    await perform("pause", async () => {
      setStopUnconfirmed(false);
      try {
        const lesson = (await voiceClient.current?.pause()) as Lesson | undefined;
        if (lesson) {
          sessionLessonId.current = "";
          updateLesson(lesson);
          setCurrentSeconds(lesson.voiceSeconds || 0);
        }
        await refresh();
      } catch (error) {
        setStopUnconfirmed(true);
        throw new Error(
          `${(error as Error).message} 音声は止めましたが、接続終了は未確認です。マイクボタンで停止を再試行してください。`,
        );
      }
    });
  }
  async function practiceRecap(section: number, point: number) {
    if (!recapLesson) return;
    await perform("exercise", async () => {
      const lesson = await api<Lesson>(`/lessons/${recapLesson.id}/recap/practice`, {
        section,
        point,
      });
      currentWriting.current = lesson;
      setWriting(lesson);
      setView("writing");
      updateLesson(await api<Lesson>(`/lessons/${lesson.id}/exercise`, {}));
    });
  }
  async function evaluate(force = false) {
    if (!writing) return;
    const l = writing,
      attemptKey = `${l.id}:${l.draft}`,
      requestId = (!force && attempts.current.get(attemptKey)) || crypto.randomUUID();
    attempts.current.set(attemptKey, requestId);
    await perform("evaluate", async () => {
      await helpRequests.current.get(l.id);
      updateLesson(await api<Lesson>(`/lessons/${l.id}/evaluate`, { requestId, answer: l.draft }));
    });
  }
  function openLesson(l: Lesson) {
    if (l.kind === "voice" && ["completed", "interrupted"].includes(l.status) && !running) {
      void openRecap(l.id);
      return;
    }
    if (l.kind === "voice") {
      if (running && active?.lessonId !== l.id) {
        setNotice("現在の会話を終了してから、別の会話を開いてください。");
        return;
      }
      setVoice(l);
    } else setWriting(l);
    setHintText("");
    setDirection(l.direction);
    setTopic(l.topic);
    setView(l.kind);
  }
  async function login() {
    const popup = window.open("about:blank", "_blank");
    await perform("login", async () => {
      try {
        const r = await api<{ authUrl: string }>("/auth/login", {});
        if (popup) popup.location.href = r.authUrl;
        else window.location.assign(r.authUrl);
        await refresh();
      } catch (e) {
        popup?.close();
        throw e;
      }
    });
  }
  const connected = status?.chatgpt.connected;
  const blocks = transcriptBlocks(voice?.rows || []);
  const pendingFocus = history.map((l) => l.review?.focus).find((f) => f?.state === "transfer_due");
  return (
    <div className="app">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("voice");
          }}
        >
          Bahasa
        </a>
        <nav aria-label="練習の切り替え">
          {(["voice", "writing", "history"] as View[]).map((v) => (
            <button
              key={v}
              className={view === v ? "nav active" : "nav"}
              onClick={() => {
                setView(v);
                setNotice("");
                if (v === "history")
                  void api<Lesson[]>("/lessons")
                    .then(setHistory)
                    .catch((e) => setNotice(e.message));
              }}
            >
              {labels[v]}
            </button>
          ))}
        </nav>
        <button
          className="settings-button"
          aria-label="接続設定"
          onClick={() => setView("settings")}
        >
          <Icon name="settings" />
        </button>
      </header>
      <main className={view === "voice" ? "voice-main" : view === "recap" ? "recap-main" : ""}>
        {notice && (
          <div role="alert" className="notice">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="通知を閉じる">
              ×
            </button>
          </div>
        )}
        {view === "voice" && (
          <div className="voice-pane">
            {voice?.exercise && (
              <details className="scene" open={Boolean(voice.practice)}>
                <summary>
                  {voice.practice
                    ? voice.practice.mode === "retry"
                      ? "同じ意図を、もう一度"
                      : "別の場面で使う"
                    : voice.exercise.title}
                </summary>
                <p>{voice.exercise.prompt}</p>
                {voice.practice && (
                  <button
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={() => void showHint(voice)}
                  >
                    見本を見る
                  </button>
                )}
                {hintText && (
                  <p>
                    <Gloss text={hintText} />
                  </p>
                )}
              </details>
            )}
            <div
              className="captions"
              ref={captionArea}
              role="log"
              aria-label="会話の字幕"
              aria-live="off"
              onScroll={() => {
                const el = captionArea.current;
                if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 45);
              }}
            >
              {blocks.length ? (
                blocks.map((block, blockIndex) => (
                  <article className={"caption-group " + block.role} key={block.id}>
                    <span className="speaker">
                      {block.role === "assistant" ? COACH_NAME : "あなた"}
                    </span>
                    <CaptionText
                      text={block.text}
                      context={{
                        speaker: block.role,
                        before: blocks
                          .slice(Math.max(0, blockIndex - 2), blockIndex)
                          .map((b) => ({ role: b.role, text: b.text })),
                        after: blocks
                          .slice(blockIndex + 1, blockIndex + 3)
                          .map((b) => ({ role: b.role, text: b.text })),
                      }}
                      prefetch={true}
                      streaming={running}
                      precision={status?.translation?.precision || DEFAULT_TRANSLATION_PRECISION}
                      onOpen={() => setFollow(false)}
                      onInspect={() => inspect(voice)}
                    />
                    {block.role === "user" && voice && (
                      <SpeechNote
                        key={block.id}
                        lessonId={voice.id}
                        source={block.text}
                        feedback={voice.speechFeedback?.find((f) => f.blockId === block.id)}
                        onShown={() => recordAssistance(voice)}
                        onInspect={() => inspect(voice)}
                        onOpen={() => setFollow(false)}
                      />
                    )}
                  </article>
                ))
              ) : (
                <div className="voice-empty">
                  <h1>{COACH_NAME} と話しましょう。</h1>
                  <p>{COACH_DESCRIPTION}</p>
                  {!status?.voice.configured && (
                    <button className="text-button" onClick={() => setView("settings")}>
                      音声 API キーを設定する
                    </button>
                  )}
                </div>
              )}
              {voice && !running && !paused && voice.rows.length > 0 && (
                <button className="text-button" onClick={() => void openRecap(voice.id)}>
                  レッスンノートを読む
                </button>
              )}
            </div>
            {!follow && blocks.length > 0 && (
              <button className="follow-button" onClick={() => setFollow(true)}>
                最新の字幕へ
              </button>
            )}
            {voice && attachedVoiceId === voice.id && (
              <ReplyHints key={voice.id} lesson={voice} onInspect={() => inspect(voice)} />
            )}
            <div className={`voice-controls${showMic ? " is-running" : ""}`}>
              {showMic ? (
                <>
                  <button
                    className="end-call"
                    disabled={connecting || Boolean(busy) || (!paused && !owns)}
                    onClick={() => void stop()}
                  >
                    {busy === "stop" ? "終了中…" : voice?.practice ? "回答を確認して終了" : "終了"}
                  </button>
                  <MicControl
                    muted={Boolean(paused) || stopUnconfirmed}
                    stopUnconfirmed={stopUnconfirmed}
                    connecting={connecting}
                    stopping={busy === "pause"}
                    disabled={
                      connecting ||
                      Boolean(busy) ||
                      !connectedEvents ||
                      (!paused && (!owns || active?.status !== "active"))
                    }
                    onChange={() => (paused ? start(voice) : pause())}
                  />
                  <span className="call-cost" title="音声の概算料金（USD）">
                    今回 ${voiceCost(currentSeconds).toFixed(2)}
                  </span>
                </>
              ) : (
                <button
                  className="primary talk-button"
                  disabled={!status?.voice.configured || !connectedEvents || Boolean(busy)}
                  onClick={() => void start()}
                >
                  <Icon name="voice" />
                  {voice?.rows.length ? "新しく話す" : "話す"}
                </button>
              )}
            </div>
            <audio ref={audio} hidden aria-label="コーチの音声" />
            {!showMic && (
              <details className="optional-practice">
                <summary>テーマを決めて練習する</summary>
                <div className="exercise-toolbar">
                  <label>
                    テーマ
                    <input list="topics" value={topic} onChange={(e) => setTopic(e.target.value)} />
                  </label>
                  <button
                    disabled={Boolean(busy) || !connected}
                    onClick={() => void newExercise("voice")}
                  >
                    {busy === "exercise" ? "準備中…" : "お題を作る"}
                  </button>
                </div>
                {pendingFocus && (
                  <button
                    className="text-button"
                    onClick={() => void beginPractice(pendingFocus, "transfer", "voice")}
                  >
                    前回の表現を、別の場面で使う
                  </button>
                )}
              </details>
            )}
          </div>
        )}
        {view === "recap" && (
          <RecapPage
            lesson={recapLesson}
            busy={Boolean(busy)}
            requestError={recapError}
            onRetry={() => void openRecap(recapId.current, true)}
            onTranscript={() => {
              if (recapLesson) {
                if (sessionLessonId.current && sessionLessonId.current !== recapLesson.id) {
                  setNotice("現在の会話を終了してから、以前の字幕を開いてください。");
                  return;
                }
                setVoice(recapLesson);
                setView("voice");
              }
            }}
            onPractice={(section, point) => void practiceRecap(section, point)}
          />
        )}
        {view === "writing" && (
          <section className="writing">
            <div className="view-heading">
              <h1>作文</h1>
              <select
                aria-label="翻訳の方向"
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
              >
                <option value="ja-id">日本語 → インドネシア語</option>
                <option value="id-ja">インドネシア語 → 日本語</option>
              </select>
            </div>
            <div className="exercise-toolbar">
              <label>
                テーマ
                <input list="topics" value={topic} onChange={(e) => setTopic(e.target.value)} />
              </label>
              <button
                disabled={!connected || Boolean(busy)}
                onClick={() => void newExercise("writing")}
              >
                {busy === "exercise" ? "準備中…" : "新しいお題"}
              </button>
            </div>
            {!connected && (
              <button className="text-button" onClick={() => setView("settings")}>
                ChatGPT に接続する
              </button>
            )}
            {writing?.exercise ? (
              <>
                <div className="writing-prompt">
                  <Gloss
                    text={writing.exercise.prompt}
                    annotations={writing.exercise.annotations}
                    onInspect={() => inspect(writing)}
                  />
                </div>
                {writing.practice && (
                  <div className="practice-instruction">
                    <p>
                      {writing.practice.mode === "retry"
                        ? "同じ意図を、自分の言葉でもう一度。"
                        : "前回の表現を、この場面で使ってみてください。"}
                    </p>
                    <button
                      className="text-button"
                      disabled={Boolean(busy)}
                      onClick={() => void showHint(writing)}
                    >
                      見本を見る
                    </button>
                    {hintText && (
                      <blockquote>
                        <Gloss text={hintText} />
                      </blockquote>
                    )}
                  </div>
                )}
                <label className="answer-label">
                  あなたの回答
                  <textarea
                    className="answer"
                    value={writing.draft}
                    disabled={busy === "evaluate"}
                    onChange={(e) => {
                      const text = e.target.value;
                      localStorage.setItem(
                        `bahasa.draft.${writing.id}`,
                        JSON.stringify({ text, updatedAt: Date.now() }),
                      );
                      setWriting({ ...writing, draft: text });
                    }}
                    placeholder={
                      writing.direction === "ja-id" ? "インドネシア語で書く…" : "日本語で書く…"
                    }
                    rows={5}
                  />
                </label>
                <div className="submit-row">
                  <small role="status">{saved}</small>
                  <button
                    className="primary"
                    disabled={!writing.draft.trim() || Boolean(busy) || !connected}
                    onClick={() => void evaluate()}
                  >
                    {busy === "evaluate" ? "確認中…" : "回答を確認する"}
                  </button>
                </div>
                {writing.attempts.length > 0 && (
                  <LearningLoop
                    lesson={writing}
                    busy={Boolean(busy)}
                    onPractice={(f, m) => void beginPractice(f, m, "writing")}
                    onReview={() => void evaluate(true)}
                  />
                )}
              </>
            ) : (
              <p className="empty-writing">お題を作って、短い文章から始めましょう。</p>
            )}
            {writing && writing.attempts.length > 1 && (
              <details className="previous-attempts">
                <summary>以前の回答</summary>
                {writing.attempts.slice(1).map((a) => (
                  <div key={a.id}>
                    <p>
                      <Gloss text={a.answer} />
                    </p>
                    <p className="muted">{a.feedback.explanation}</p>
                  </div>
                ))}
              </details>
            )}
          </section>
        )}
        {((view === "voice" && voice?.practice && !voice.exercise) ||
          (view === "writing" && writing && !writing.exercise)) && (
          <div className="retry-exercise">
            <button
              disabled={Boolean(busy)}
              onClick={() => {
                const l = view === "voice" ? voice! : writing!;
                void perform("exercise", async () =>
                  updateLesson(await api<Lesson>(`/lessons/${l.id}/exercise`, {})),
                );
              }}
            >
              お題の作成を再試行
            </button>
          </div>
        )}
        {view === "history" && (
          <section className="history">
            <div className="view-heading">
              <h1>履歴</h1>
            </div>
            <input
              aria-label="履歴を検索"
              type="search"
              placeholder="言葉やテーマで検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {history
              .filter((l) => JSON.stringify(l).toLowerCase().includes(search.toLowerCase()))
              .map((l) => (
                <button className="history-row" key={l.id} onClick={() => openLesson(l)}>
                  <div>
                    <span className="history-kind">
                      {l.kind === "voice" ? "会話" : "作文"}
                      {l.practice
                        ? l.practice.mode === "retry"
                          ? " · 言い直し"
                          : " · 別の場面"
                        : ""}
                    </span>
                    <strong>{l.title}</strong>
                    {l.practice?.check && (
                      <small>
                        {l.practice.check.outcome === "pass"
                          ? l.practice.check.assisted
                            ? "ヒントを使って確認"
                            : "回答を確認済み"
                          : l.practice.check.outcome === "retry"
                            ? "再練習中"
                            : "確認が必要"}
                      </small>
                    )}
                  </div>
                  <time>
                    {new Date(l.createdAt).toLocaleDateString("ja-JP", {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                </button>
              ))}
            {!history.length && <p className="empty-writing">まだ練習の記録はありません。</p>}
          </section>
        )}
        {view === "settings" && (
          <section className="settings">
            <h1>接続設定</h1>
            <section>
              <h2>ChatGPT</h2>
              {connected ? (
                <>
                  <p>
                    {status.chatgpt.email} · {status.chatgpt.plan}
                  </p>
                  <button
                    disabled={Boolean(busy) || running}
                    onClick={() =>
                      void perform("logout", async () => {
                        await api("/auth/logout", {});
                        await refresh();
                      })
                    }
                  >
                    サインアウト
                  </button>
                </>
              ) : (
                <button className="primary" disabled={Boolean(busy)} onClick={() => void login()}>
                  ChatGPT でサインイン
                </button>
              )}
              {status?.chatgpt.pending && (
                <p role="status">ブラウザでサインインを完了してください。</p>
              )}
              {status?.chatgpt.error && <p className="error-text">{status.chatgpt.error}</p>}
              <p className="muted">
                単語の説明・返答のヒント・練習の確認に、Pro の利用枠を使います。
              </p>
            </section>
            <TranslationSettings
              value={status?.translation?.precision || DEFAULT_TRANSLATION_PRECISION}
              disabled={Boolean(busy)}
              onChange={(precision) =>
                void perform("translation-setting", async () => {
                  const value = await api<{ precision: typeof precision }>(
                    "/settings/translation",
                    { precision },
                  );
                  setStatus((prior) => (prior ? { ...prior, translation: value } : prior));
                })
              }
            />
            <section>
              <h2>音声 API</h2>
              <p className="muted">
                GPT-Live-1 · $0.05／分{status?.voice.configured ? " · キー登録済み" : ""}
                <br />
                マイクをオンにする再接続には15秒分の初期化料金があり、その接続の利用時間に充当されます。
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform("key", async () => {
                    await api("/settings/voice-key", { key });
                    setKey("");
                    await refresh();
                  });
                }}
              >
                <label>
                  OpenAI API キー
                  <input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    autoComplete="off"
                    placeholder={status?.voice.configured ? "変更するときだけ入力" : "sk-…"}
                  />
                </label>
                <button disabled={key.trim().length < 10 || Boolean(busy) || running}>保存</button>
              </form>
              <p className="muted">
                今月の音声：${voiceCost(status?.voice.monthSeconds || 0).toFixed(2)}（概算 USD）
                {status?.voice.unconfirmed ? " 未確定分を含みます。" : ""}
              </p>
            </section>
          </section>
        )}
        <datalist id="topics">
          {TOPICS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </main>
    </div>
  );
}
