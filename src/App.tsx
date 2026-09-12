import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  TOPICS,
  voiceCost,
  type AppEvent,
  type AppStatus,
  type Direction,
  type Feedback,
  type Lesson,
  type TranscriptRow,
} from "../shared/types";
import { api } from "./api";
import { VoiceClient } from "./voice";
import { Gloss } from "./Gloss";

type View = "voice" | "writing" | "history" | "settings";
const labels: Record<View, string> = {
  voice: "会話",
  writing: "作文",
  history: "履歴",
  settings: "接続設定",
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
function FeedbackView({ feedback }: { feedback: Feedback }) {
  return (
    <section className="feedback">
      <h2>振り返り</h2>
      <div className="natural">
        <Gloss text={feedback.natural} annotations={feedback.annotations} />
      </div>
      <p className="preserve">
        <Gloss text={feedback.explanation} annotations={feedback.annotations} />
      </p>
      {feedback.points.map((p, i) => (
        <div className="feedback-point" key={i}>
          <div className="original-example">{p.original}</div>
          <div className="suggestion">
            <Gloss text={p.suggestion} annotations={feedback.annotations} />
          </div>
          <p>
            <Gloss text={p.reason} annotations={feedback.annotations} />
          </p>
        </div>
      ))}
      {feedback.nextFocus.length > 0 && (
        <p className="next-focus">次に練習したいこと：{feedback.nextFocus.join("・")}</p>
      )}
      <small>下線のある語句に触れると、意味と正式形が見られます。</small>
    </section>
  );
}

function Caption({
  row,
  lessonId,
  onSaved,
  report,
}: {
  row: TranscriptRow;
  lessonId: string;
  onSaved: (l: Lesson) => void;
  report: (s: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [text, setText] = useState(""),
    [source, setSource] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  function edit() {
    setSource(row.original);
    setText(row.corrected ?? row.original);
    setReason("");
    setEditing(true);
  }
  async function correct() {
    setBusy(true);
    try {
      const r = await api<{ original: string; corrected: string; explanation: string }>(
        `/lessons/${lessonId}/correct`,
        { rowId: row.id },
      );
      setText(r.corrected);
      setSource(r.original);
      setReason(r.explanation);
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      onSaved(
        await api<Lesson>(`/lessons/${lessonId}/revise`, {
          rowId: row.id,
          original: source,
          corrected: text,
        }),
      );
      setEditing(false);
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`caption ${row.role}`}>
      <div className="caption-meta">
        <span>{row.role === "assistant" ? "コーチ" : "あなた"}</span>
        <button className="text-button" onClick={edit}>
          字幕を修正
        </button>
      </div>
      <p className="caption-text" dir="auto">
        {row.corrected ?? row.original}
      </p>
      {row.corrected !== null && (
        <details>
          <summary>補正済み・原文を見る</summary>
          <p>{row.original}</p>
        </details>
      )}
      {row.revisionStale && <small>原文が更新されたため、以前の補正は適用していません。</small>}
      {editing && (
        <div className="caption-editor">
          <label>
            聞き取られた内容を修正
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          </label>
          <div className="button-row">
            <button onClick={() => void correct()} disabled={busy}>
              文脈から補正
            </button>
            <button className="primary" onClick={() => void save()} disabled={busy}>
              この内容で保存
            </button>
            <button className="text-button" onClick={() => setEditing(false)}>
              キャンセル
            </button>
          </div>
          {reason && (
            <p className="hint">{reason}（補正案です。音声を再認識した結果ではありません。）</p>
          )}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [view, setView] = useState<View>("voice"),
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
    [muted, setMuted] = useState(false),
    [connecting, setConnecting] = useState(false),
    [connectedEvents, setConnectedEvents] = useState(false),
    [search, setSearch] = useState(""),
    [follow, setFollow] = useState(true),
    [currentSeconds, setCurrentSeconds] = useState(0);
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
  const refresh = useCallback(async () => {
    try {
      setStatus(await api<AppStatus>("/status"));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, []);
  function updateLesson(l: Lesson) {
    setHistory((items) => [l, ...items.filter((i) => i.id !== l.id)]);
    if (l.kind === "voice" && (!currentVoice.current || currentVoice.current.id === l.id))
      setVoice(l);
    if (l.kind === "writing" && currentWriting.current?.id === l.id) setWriting(l);
  }
  async function reviewVoice(id: string) {
    if (reviews.current.has(id)) return reviews.current.get(id);
    const job = (async () => {
      const l = await api<Lesson>(`/lessons/${id}`);
      updateLesson(l);
      if (!l.rows.length || l.attempts.length) return;
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
        if (u) setCurrentSeconds(u.seconds);
      }
      if (event.event.type === "session.closed" || event.event.type === "local.closed") {
        voiceClient.current?.cleanup();
        setConnecting(false);
        setMuted(false);
        const u = event.event.usage as { seconds?: number };
        if (u?.seconds != null) setCurrentSeconds(u.seconds);
        void refresh();
        void reviewVoice(event.lessonId);
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
      ws.onopen = () => setConnectedEvents(true);
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data));
        } catch {}
      };
      ws.onclose = () => {
        setConnectedEvents(false);
        if (!stopped) {
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
  const active = status?.voice.active,
    owns = active?.owner === owner.current,
    running = Boolean(active) || connecting;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(
      () => setCurrentSeconds(Math.max(active.seconds, (Date.now() - active.startedAt) / 1000)),
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
  async function start() {
    if (!voice || !audio.current) return;
    setNotice("");
    setConnecting(true);
    setCurrentSeconds(0);
    const client = new VoiceClient(owner.current, audio.current);
    voiceClient.current = client;
    try {
      await client.start(
        voice.id,
        (event) => {
          if (socket.current?.readyState === WebSocket.OPEN)
            socket.current.send(JSON.stringify({ type: "live.event", event }));
        },
        setNotice,
      );
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
      setConnecting(false);
      await refresh();
    }
  }
  async function stop() {
    await perform("stop", async () => {
      await voiceClient.current?.stop();
      setConnecting(false);
      setMuted(false);
      await refresh();
      if (voice) await reviewVoice(voice.id);
    });
  }
  async function evaluate() {
    if (!writing) return;
    const l = writing,
      attemptKey = `${l.id}:${l.draft}`,
      requestId = attempts.current.get(attemptKey) || crypto.randomUUID();
    attempts.current.set(attemptKey, requestId);
    await perform("evaluate", async () => {
      updateLesson(await api<Lesson>(`/lessons/${l.id}/evaluate`, { requestId, answer: l.draft }));
    });
  }
  function openLesson(l: Lesson) {
    if (l.kind === "voice") {
      if (running && active?.lessonId !== l.id) {
        setNotice("現在の会話を終了してから、別の会話を開いてください。");
        return;
      }
      setVoice(l);
    } else setWriting(l);
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
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("voice");
          }}
        >
          <span className="brand-mark">b.</span>
          <span>
            Bahasa
            <br />
            <b>Coach</b>
          </span>
        </a>
        <nav aria-label="練習の切り替え">
          {(["voice", "writing", "history"] as View[]).map((v) => (
            <button
              key={v}
              className={view === v ? "nav active" : "nav"}
              onClick={() => {
                setView(v);
                setNotice("");
                if (v === "history") void api<Lesson[]>("/lessons").then(setHistory);
              }}
            >
              <Icon name={v} />
              {labels[v]}
              {v === "voice" && running && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-label">
            <span className={connected ? "dot good" : "dot"} />
            {connected ? "ChatGPT 接続済み" : "ChatGPT 未接続"}
          </div>
          <button
            className={view === "settings" ? "nav active" : "nav"}
            onClick={() => setView("settings")}
          >
            <Icon name="settings" />
            接続設定
          </button>
          <p>
            少しずつ、
            <br />
            自分の言葉に。
          </p>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <h1>
              {view === "voice" ? "話してみる" : view === "writing" ? "書いてみる" : labels[view]}
            </h1>
            <p>
              {view === "voice"
                ? "考えながらで大丈夫。字幕を見ながら、会話を続けよう。"
                : view === "writing"
                  ? "伝えたいことを、自然なインドネシア語に。"
                  : view === "history"
                    ? "前に練習したことが、次の会話につながる。"
                    : "文章は ChatGPT Pro、音声は API で接続します。"}
            </p>
          </div>
          <div className="monthly">
            <span>今月の音声</span>
            <strong>${voiceCost(status?.voice.monthSeconds || 0).toFixed(2)}</strong>
            <small>概算 USD{status?.voice.unconfirmed ? "・未確定分を含む" : ""}</small>
          </div>
        </header>
        {notice && (
          <div role="alert" className="notice">
            <span>{notice}</span>
            <button className="text-button" onClick={() => setNotice("")} aria-label="通知を閉じる">
              閉じる
            </button>
          </div>
        )}
        {((view === "voice" && voice && !voice.exercise) ||
          (view === "writing" && writing && !writing.exercise)) && (
          <div className="setup-note">
            <span>お題の作成が途中です。入力したテーマは保存されています。</span>
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
        {!connected && view !== "settings" && (
          <div className="setup-note">
            <span>はじめに ChatGPT を接続すると、出題と添削を使えます。</span>
            <button className="text-button" onClick={() => setView("settings")}>
              接続設定へ <Icon name="arrow" />
            </button>
          </div>
        )}
        {(view === "voice" || view === "writing") && (
          <div className="exercise-toolbar">
            <label>
              練習するテーマ
              <input
                list="topics"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例：締め切りの延長を相談する"
              />
              <datalist id="topics">
                {TOPICS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            {view === "writing" && (
              <label>
                翻訳の方向
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as Direction)}
                >
                  <option value="ja-id">日本語 → インドネシア語</option>
                  <option value="id-ja">インドネシア語 → 日本語</option>
                </select>
              </label>
            )}
            <button
              className="primary"
              disabled={Boolean(busy) || !connected || (view === "voice" && running)}
              onClick={() => void newExercise(view as "voice" | "writing")}
            >
              {busy === "exercise" ? "お題を考えています…" : "お題を出してもらう"}
              <Icon name="arrow" />
            </button>
          </div>
        )}
        {view === "voice" && (
          <>
            <div className="voice-layout">
              <section className="conversation">
                <div className="section-bar">
                  <h2>会話の字幕</h2>
                  <span className="status-pill">
                    <span className={`dot ${running ? "good" : ""}`} />
                    {connecting
                      ? "接続中"
                      : active?.status === "closing"
                        ? "終了処理中"
                        : running
                          ? muted
                            ? "マイク停止中"
                            : "会話中"
                          : "待機中"}
                  </span>
                </div>
                <div
                  className="captions"
                  ref={captionArea}
                  role="log"
                  aria-label="会話の字幕"
                  aria-live="off"
                  onScroll={() => {
                    const el = captionArea.current;
                    if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
                  }}
                >
                  {voice?.rows.length ? (
                    voice.rows.map((row) => (
                      <Caption
                        key={row.id}
                        row={row}
                        lessonId={voice.id}
                        onSaved={updateLesson}
                        report={setNotice}
                      />
                    ))
                  ) : (
                    <div className="empty-caption">
                      <Icon name="voice" />
                      <h3>ここに、二人の言葉が残ります。</h3>
                      <p>
                        お題を選んで会話を始めましょう。
                        <br />
                        わからない言葉は、日本語で聞いても大丈夫。
                      </p>
                      <div className="language-note">Indonesia · 日本語 · English · 中文</div>
                    </div>
                  )}
                </div>
                {!follow && (
                  <button className="follow-button" onClick={() => setFollow(true)}>
                    最新の字幕へ ↓
                  </button>
                )}
                <div className="voice-controls">
                  {!running ? (
                    <button
                      className="primary"
                      disabled={
                        !voice ||
                        voice.status !== "draft" ||
                        !connected ||
                        !status?.voice.configured ||
                        !connectedEvents ||
                        Boolean(busy)
                      }
                      onClick={() => void start()}
                    >
                      <Icon name="voice" />
                      会話を始める
                    </button>
                  ) : (
                    <>
                      <button
                        className="stop"
                        disabled={(!owns && !connecting) || busy === "stop"}
                        onClick={() => void stop()}
                      >
                        {busy === "stop" ? "終了しています…" : "会話を終了"}
                      </button>
                      <button
                        disabled={!owns}
                        onClick={() => {
                          voiceClient.current?.mute(!muted);
                          setMuted(!muted);
                        }}
                      >
                        {muted ? "マイクを再開" : "マイクを停止"}
                      </button>
                    </>
                  )}
                  <span className="session-cost">
                    今回 ${voiceCost(currentSeconds).toFixed(2)} <small>概算</small>
                  </span>
                </div>
                <audio
                  ref={audio}
                  controls
                  className={running ? "audio-player" : "audio-player hidden"}
                  aria-label="コーチの音声"
                />
                {!status?.voice.configured && (
                  <p className="small-help">
                    音声を使うには、接続設定で API キーを登録してください。
                  </p>
                )}
              </section>
              <aside className="lesson-margin">
                <h2>今日の場面</h2>
                {voice?.exercise ? (
                  <>
                    <h3>{voice.exercise.title}</h3>
                    <p className="preserve">{voice.exercise.prompt}</p>
                    <p className="hint">{voice.exercise.context}</p>
                    <div className="focus-list">
                      {voice.exercise.focus.map((f) => (
                        <span key={f}>{f}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="hint">
                    あなたの練習履歴をもとに、仕事や日常で使える場面を提案します。
                  </p>
                )}
                <div className="help-actions">
                  <h3>会話の途中でも</h3>
                  {[
                    ["repeat", "もう一度言って"],
                    ["slow", "ゆっくり話して"],
                    ["japanese", "日本語で説明して"],
                  ].map(([action, label]) => (
                    <button
                      key={action}
                      disabled={!owns || active?.status !== "active"}
                      onClick={() => {
                        void api("/live/action", { owner: owner.current, action }).catch((e) =>
                          setNotice(e.message),
                        );
                      }}
                    >
                      {label}
                      <Icon name="arrow" />
                    </button>
                  ))}
                </div>
                <p className="small-help">字幕は自動保存されます。録音は残りません。</p>
              </aside>
            </div>
            {busy === "review" && (
              <p className="working" role="status">
                会話を振り返っています…
              </p>
            )}
            {voice?.attempts[0] && <FeedbackView feedback={voice.attempts[0].feedback} />}{" "}
            {voice &&
              voice.rows.length > 0 &&
              !running &&
              !voice.attempts.length &&
              busy !== "review" && (
                <button onClick={() => void reviewVoice(voice.id)}>振り返りを作成する</button>
              )}
          </>
        )}
        {view === "writing" && (
          <div className="writing-layout">
            <section className="writing-work">
              <div className="section-bar">
                <h2>{writing?.exercise?.title || "今日のお題"}</h2>
                <span className="muted">
                  {writing?.direction === "id-ja" ? "ID → JP" : "JP → ID"}
                </span>
              </div>
              {writing?.exercise ? (
                <>
                  <p className="writing-prompt preserve">
                    <Gloss
                      text={writing.exercise.prompt}
                      annotations={writing.exercise.annotations}
                    />
                  </p>
                  <p className="hint">{writing.exercise.context}</p>
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
                        writing.direction === "ja-id"
                          ? "インドネシア語で書いてみましょう…"
                          : "日本語で意味を書いてみましょう…"
                      }
                      rows={8}
                    />
                  </label>
                  <div className="submit-row">
                    <small role="status">{saved}</small>
                    <button
                      className="primary"
                      disabled={!writing.draft.trim() || Boolean(busy) || !connected}
                      onClick={() => void evaluate()}
                    >
                      {busy === "evaluate"
                        ? "添削しています…"
                        : writing.attempts.length
                          ? "書き直した文章を添削"
                          : "添削してもらう"}
                      <Icon name="arrow" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-writing">
                  <Icon name="writing" />
                  <h3>まずは、短い文章から。</h3>
                  <p>
                    お題を出してもらって、思いつく言葉で書いてみましょう。
                    <br />
                    下書きは自動で保存されます。
                  </p>
                </div>
              )}
            </section>
            {writing?.attempts[0] ? (
              <FeedbackView feedback={writing.attempts[0].feedback} />
            ) : (
              <aside className="lesson-margin">
                <h2>自然な言い方を身につける</h2>
                <p>
                  意味が伝わるか、会話で自然か、相手に合った丁寧さか。３つの視点で振り返ります。
                </p>
                <p className="hint">添削の下線に触れると、その文での意味と正式な形が見られます。</p>
              </aside>
            )}
          </div>
        )}
        {view === "writing" && writing && writing.attempts.length > 1 && (
          <details className="previous-attempts">
            <summary>以前の回答と添削（{writing.attempts.length - 1}回）</summary>
            {writing.attempts.slice(1).map((attempt) => (
              <section key={attempt.id}>
                <p className="preserve">回答：{attempt.answer}</p>
                <FeedbackView feedback={attempt.feedback} />
              </section>
            ))}
          </details>
        )}
        {view === "history" && (
          <section className="history">
            <label className="search">
              履歴を検索
              <input
                type="search"
                placeholder="テーマや練習した言葉"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {history
              .filter((l) => JSON.stringify(l).toLowerCase().includes(search.toLowerCase()))
              .map((l) => (
                <button className="history-row" key={l.id} onClick={() => openLesson(l)}>
                  <Icon name={l.kind} />
                  <div>
                    <strong>{l.title}</strong>
                    <p>
                      {l.attempts[0]?.feedback.nextFocus.join("・") ||
                        l.exercise?.prompt ||
                        "お題の作成が途中です。開いて再試行できます。"}
                    </p>
                  </div>
                  <time>
                    {new Date(l.createdAt).toLocaleDateString("ja-JP", {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                  <Icon name="arrow" />
                </button>
              ))}
            {!history.length && (
              <div className="empty-writing">
                <h3>ここから、積み重ねていこう。</h3>
                <p>会話や作文をすると、ここに練習の記録が残ります。</p>
              </div>
            )}
          </section>
        )}
        {view === "settings" && (
          <div className="settings">
            <section>
              <div className="section-bar">
                <h2>文章の指導</h2>
                <span className="status-pill">{connected ? "接続済み" : "未接続"}</span>
              </div>
              <h3>ChatGPT でサインイン</h3>
              <p>出題・添削・字幕の補正に、サブスクリプションの利用枠を使います。</p>
              {connected ? (
                <>
                  <p className="account">
                    {status.chatgpt.email}
                    <span>{status.chatgpt.plan}</span>
                  </p>
                  <button
                    onClick={() =>
                      void perform("logout", async () => {
                        await api("/auth/logout", {});
                        await refresh();
                      })
                    }
                    disabled={Boolean(busy) || running}
                  >
                    このアプリからサインアウト
                  </button>
                </>
              ) : (
                <button className="primary" disabled={Boolean(busy)} onClick={() => void login()}>
                  {status?.chatgpt.pending ? "サインイン画面を開き直す" : "ChatGPT に接続する"}
                  <Icon name="arrow" />
                </button>
              )}
              {status?.chatgpt.pending && (
                <p role="status" className="hint">
                  ブラウザでサインインを完了すると、自動で接続されます。
                </p>
              )}
              {status?.chatgpt.error && <p className="error-text">{status.chatgpt.error}</p>}
              <p className="small-help">
                普段の Codex 利用と枠を共有します。文章 API への自動切替はありません。
              </p>
            </section>
            <section>
              <div className="section-bar">
                <h2>音声の接続</h2>
                <span className="status-pill">
                  {status?.voice.configured ? "キー登録済み" : "未設定"}
                </span>
              </div>
              <h3>GPT-Live-1 API キー</h3>
              <p>音声は別料金です。現在の単価は $0.05／分。金額による利用制限はありません。</p>
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
                  OpenAI プロジェクトの API キー
                  <input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    autoComplete="off"
                    placeholder={
                      status?.voice.configured ? "変更する場合は新しいキーを入力" : "sk-…"
                    }
                  />
                </label>
                <button
                  className="primary"
                  disabled={key.trim().length < 10 || Boolean(busy) || running}
                >
                  キーを保存
                </button>
              </form>
              <p className="small-help">
                キーはこの Mac
                のサーバーに保存されます。会話は「会話を始める」を押したときだけ接続します。
              </p>
            </section>
          </div>
        )}
        <footer>
          自然な口語を、少しずつ。<span>学習データはこの Mac に保存</span>
        </footer>
      </main>
    </div>
  );
}
