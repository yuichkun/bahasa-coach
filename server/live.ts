import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { AppEvent, LiveInfo } from "../shared/types.ts";
import type { Store } from "./store.ts";
import type { Tutor } from "./tutor.ts";

type Json = Record<string, any>;
interface Running extends LiveInfo {
  key: string;
  socket: WebSocket | null;
  seen: Set<string>;
  done: Promise<void>;
  finish: () => void;
  closing: Promise<void> | null;
}
export class LiveManager {
  private active: Running | null = null;
  private store: Store;
  private tutor: Tutor;
  private key: () => string;
  private emit: (e: AppEvent) => void;
  constructor(store: Store, tutor: Tutor, key: () => string, emit: (e: AppEvent) => void) {
    this.store = store;
    this.tutor = tutor;
    this.key = key;
    this.emit = emit;
  }
  info(): LiveInfo | null {
    if (!this.active) return null;
    const { lessonId, sessionId, owner, status, seconds, startedAt } = this.active;
    return { lessonId, sessionId, owner, status, seconds, startedAt };
  }
  private async api(path: string, key: string, body?: unknown) {
    const response = await fetch(`https://api.openai.com/v1/live/sessions${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      let message = "";
      try {
        message = ((await response.json()) as Json).error?.message || "";
      } catch {}
      throw new Error(
        `音声 API に接続できませんでした (${response.status})。${message || "API キーと GPT-Live-1 の利用権限を確認してください。"}`,
      );
    }
    return response.status === 204 ? null : response.json().catch(() => null);
  }
  async start(owner: string, lessonId: string, sdp: string) {
    if (this.active)
      throw Object.assign(new Error("会話はすでに接続中です。現在の会話を終了してください。"), {
        statusCode: 409,
      });
    const key = this.key();
    if (!key)
      throw Object.assign(new Error("接続設定で音声 API キーを登録してください。"), {
        statusCode: 400,
      });
    const lesson = this.store.get(lessonId);
    if (lesson.kind !== "voice" || lesson.status !== "draft")
      throw Object.assign(new Error("新しい会話のお題を作成してください。"), { statusCode: 409 });
    let finish!: () => void;
    const state: Running = {
      owner,
      lessonId,
      sessionId: null,
      status: "connecting",
      seconds: 15,
      startedAt: Date.now(),
      key,
      socket: null,
      seen: new Set(),
      done: new Promise((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
      closing: null,
    };
    this.active = state;
    try {
      const result = (await this.api("", key, {
        session: {
          model: "gpt-live-1",
          store: false,
          delegation: { type: "client" },
          instructions: `You are a friendly Indonesian conversation partner for a Japanese-speaking adult learning natural, moderately informal Indonesian for nuanced work conversations. Speak briefly and ask one question at a time. Listen while speaking; allow natural interruptions. Do not keep talking when asked to wait. Accept Indonesian, Japanese, English and Chinese mixed within a sentence. Answer Japanese explanation requests in Japanese, otherwise speak Indonesian. Use authentic colloquial forms appropriate for adult colleagues, not exaggerated slang or mechanically deleted prefixes. Focus on conversation; save most correction until the end. Delegate detailed grammar, word explanations, and teaching questions to the backend. Do not claim backend work is finished until results arrive. The user may select a phrase on the screen; use supplied context.`,
          input: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: lesson.exercise
                    ? `練習したい場面: ${lesson.exercise.prompt}\n${lesson.practice ? "This is one focused output practice. Ask the learner to express the stated intention, then listen. Do not provide a model answer unless asked. The learner will press the check button when finished." : "Please begin this roleplay with one short question in Indonesian, then wait for me."}`
                    : "Start a free conversation in Indonesian with one brief greeting and an open-ended question. There is no assigned exercise. Follow the topic I choose. Do not ask me to select a practice theme.",
                },
              ],
            },
          ],
        },
        transport: { type: "webrtc", sdp },
      })) as Json;
      if (!result?.session?.id || !result?.transport?.sdp)
        throw new Error("音声 API の接続情報を読み取れませんでした。");
      state.sessionId = result.session.id;
      this.store.usageStart(lessonId, state.sessionId!);
      this.store.status(lessonId, "active");
      if (this.active !== state || state.status === "closing") {
        await this.hangup(state);
        throw new Error("接続はキャンセルされました。");
      }
      await this.attach(state);
      return {
        session: { id: state.sessionId },
        transport: { type: "webrtc", sdp: result.transport.sdp },
      };
    } catch (error) {
      if (state.sessionId) await this.hangup(state).catch(() => {});
      this.finalize(state, false);
      throw error;
    }
  }
  private attach(state: Running) {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(state.sessionId!)}/attach`,
        { headers: { Authorization: `Bearer ${state.key}` }, handshakeTimeout: 10_000 },
      );
      state.socket = ws;
      ws.once("open", resolve);
      ws.on("message", (data) => {
        try {
          const buffer = Buffer.isBuffer(data)
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.from(data);
          this.event(state, JSON.parse(buffer.toString("utf8")));
        } catch {
          this.emit({
            type: "notice",
            message: "音声イベントを読み取れませんでした。字幕の接続状態を確認してください。",
          });
        }
      });
      ws.on("error", () => {
        reject(new Error("音声の字幕・制御接続を確立できませんでした。"));
        if (this.active === state) void this.stop("connection_error");
      });
      ws.on("close", () => {
        if (this.active === state && state.status !== "closing") {
          this.emit({ type: "notice", message: "字幕の接続が切れたため会話を終了します。" });
          void this.stop("connection_lost");
        }
      });
    });
  }
  fromBrowser(owner: string, event: Json) {
    const s = this.active;
    if (s?.owner === owner) this.event(s, event);
  }
  private event(s: Running, e: Json) {
    if (this.active !== s) return;
    const accepted = [
      "session.started",
      "session.closed",
      "session.usage.updated",
      "session.input_transcript.delta",
      "session.output_transcript.delta",
      "session.delegation.created",
      "error",
    ];
    if (!accepted.includes(e.type)) return;
    if (e.event_id) {
      if (s.seen.has(e.event_id)) return;
      s.seen.add(e.event_id);
    }
    if (e.type.endsWith("_transcript.delta")) {
      if (
        typeof e.delta !== "string" ||
        !Number.isFinite(e.start_ms) ||
        !Number.isFinite(e.end_ms) ||
        typeof e.event_id !== "string"
      )
        return;
      if (
        this.store.fragment(
          s.lessonId,
          e as { event_id: string; delta: string; start_ms: number; end_ms: number; type: string },
        )
      )
        this.emit({ type: "lesson", lesson: this.store.get(s.lessonId) });
    } else if (e.type === "session.started") {
      s.status = s.status === "closing" ? "closing" : "active";
    } else if (e.type === "session.usage.updated") {
      const seconds = e.usage?.seconds;
      if (Number.isFinite(seconds)) {
        s.seconds = Math.max(s.seconds, seconds);
        this.store.usage(s.lessonId, seconds);
      }
    } else if (e.type === "session.closed") {
      if (Number.isFinite(e.usage?.seconds)) {
        s.seconds = e.usage.seconds;
        this.store.usage(s.lessonId, e.usage.seconds, true);
      }
      this.emit({ type: "live", event: e, lessonId: s.lessonId });
      this.finalize(s, e.reason === "close_requested" || e.reason === "remote_hangup");
      return;
    } else if (
      e.type === "session.delegation.created" &&
      e.delegation?.target === "client" &&
      typeof e.delegation?.id === "string"
    ) {
      const delegationId = e.delegation.id;
      void (async () => {
        // Allow captions already in flight to join the context; no turn-final assumption.
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (this.active !== s || s.status === "closing") return;
        const result = await this.tutor.delegate(s.lessonId);
        if (this.active === s && this.info()?.status !== "closing")
          this.send(s, {
            type: "session.commentary.append",
            event_id: randomUUID(),
            delegation_id: delegationId,
            content: result.spokenAdvice.slice(0, 1800),
          });
      })().catch(() => {
        if (this.active === s && s.status !== "closing") {
          this.emit({
            type: "notice",
            message:
              "詳しい解説を取得できませんでした。接続設定を確認してください。会話は続けられます。",
          });
          this.send(s, {
            type: "session.commentary.append",
            event_id: randomUUID(),
            delegation_id: delegationId,
            content:
              "The detailed teaching backend is unavailable. Briefly say in Japanese that detailed explanation is temporarily unavailable; continue the conversation without claiming it succeeded.",
          });
        }
      });
    }
    this.emit({ type: "live", event: e, lessonId: s.lessonId });
  }
  private send(s: Running, e: Json) {
    if (s.socket?.readyState === WebSocket.OPEN) s.socket.send(JSON.stringify(e));
  }
  action(owner: string, action: string) {
    const s = this.active;
    if (!s || s.owner !== owner || s.status !== "active")
      throw new Error("会話が接続されていません。");
    const text: Record<string, string> = {
      repeat: "The learner asks you to repeat your last utterance, then pause to listen.",
      slow: "The learner asks you to repeat your last utterance more slowly and keep a slower speaking pace, then listen.",
      japanese:
        "The learner asks you to explain your last utterance in Japanese, briefly, then listen.",
    };
    if (!text[action]) throw new Error("不明な操作です。");
    this.send(s, {
      type: "session.instructions.append",
      event_id: randomUUID(),
      delegation_id: null,
      content: text[action],
    });
  }
  disconnected(owner: string) {
    if (this.active?.owner === owner) void this.stop("browser_disconnected");
  }
  private hangup(s: Running) {
    if (!s.sessionId) return Promise.resolve();
    return this.api(`/${encodeURIComponent(s.sessionId)}/hangup`, s.key).then(() => {});
  }
  stop(reason = "close_requested"): Promise<void> {
    const s = this.active;
    if (!s) return Promise.resolve();
    if (s.closing) return s.closing;
    s.status = "closing";
    s.closing = (async () => {
      this.send(s, { type: "session.close", event_id: randomUUID() });
      let timeout: NodeJS.Timeout | undefined;
      const expired = await Promise.race([
        s.done.then(() => false),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(true), 6000);
        }),
      ]);
      clearTimeout(timeout);
      if (expired && this.active === s) {
        await this.hangup(s).catch(() => {
          this.emit({
            type: "notice",
            message: "音声の終了確認が取れませんでした。利用料金は未確定です。",
          });
        });
        if (this.active === s) {
          this.store.usage(s.lessonId, Math.max(s.seconds, (Date.now() - s.startedAt) / 1000));
          this.emit({
            type: "live",
            event: { type: "local.closed", reason, finalUsageConfirmed: false },
            lessonId: s.lessonId,
          });
          this.finalize(s, reason === "close_requested");
        }
      }
    })();
    return s.closing;
  }
  private finalize(s: Running, completed: boolean) {
    if (this.active !== s) return;
    this.store.status(
      s.lessonId,
      s.sessionId ? (completed ? "completed" : "interrupted") : "draft",
    );
    this.active = null;
    s.finish();
    s.socket?.close();
    this.emit({ type: "lesson", lesson: this.store.get(s.lessonId) });
  }
}
