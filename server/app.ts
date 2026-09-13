import { reportError } from "../shared/errors.ts";
import { directionFor, directionSchema, languageOf, languageSchema } from "../shared/languages.ts";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import type WebSocket from "ws";
import type { AppEvent, AppStatus } from "../shared/types.ts";
import { Store } from "./store.ts";
import { CodexBackend, type TutorBackend } from "./codex.ts";
import { Tutor } from "./tutor.ts";
import { LiveManager } from "./live.ts";
import { words, normalizeWord } from "../shared/glossary.ts";
import { translationPrecisionSchema } from "../shared/translation-settings.ts";
import { translationRequestSchema } from "../shared/translation.ts";

export async function createApp(options: {
  dataDir: string;
  origin: string;
  voiceKey?: string;
  backend?: TutorBackend;
  store?: Store;
}) {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  const store = options.store || new Store(join(options.dataDir, "bahasa.sqlite"));
  store.recover();
  const backend = options.backend || new CodexBackend(options.dataDir),
    tutor = new Tutor(backend, store);
  const keyPath = join(options.dataDir, "voice-key");
  let voiceKey = existsSync(keyPath)
    ? readFileSync(keyPath, "utf8").trim()
    : options.voiceKey || "";
  const clients = new Map<string, WebSocket>();
  const emit = (event: AppEvent) => {
    for (const socket of clients.values())
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
  };
  const live = new LiveManager(store, tutor, () => voiceKey, emit);
  for (const glossary of Object.values(tutor.glossaries))
    glossary.onReady = (update) => emit({ type: "glossary", ...update });
  tutor.speech.onChange = (lesson) => emit({ type: "lesson", lesson });
  tutor.speech.resumePending();
  tutor.recap.onChange = (lesson) => emit({ type: "lesson", lesson });
  tutor.recap.resumePending();
  const status = async (): Promise<AppStatus> => {
    const u = store.monthUsage();
    return {
      chatgpt: await backend.status(),
      translation: { precision: tutor.translator.precision },
      voice: {
        configured: Boolean(voiceKey),
        active: live.info(),
        monthSeconds: u.seconds,
        unconfirmed: u.unconfirmed,
        pricePerMinute: 0.05,
      },
    };
  };
  const jobs = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const prior = jobs.get(key);
    if (prior) return prior as Promise<T>;
    const job = operation().finally(() => jobs.delete(key));
    jobs.set(key, job);
    return job;
  };
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const host = new URL(options.origin).host;
    if (req.headers.host !== host && req.headers.host !== host.replace("localhost", "127.0.0.1"))
      return reply.code(403).send({ error: "ローカルアプリから接続してください。" });
    if (req.headers.origin && req.headers.origin !== options.origin)
      return reply.code(403).send({ error: "別のサイトからの操作は許可されていません。" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return reply.code(403).send({ error: "別のサイトからの操作は許可されていません。" });
    if (req.method !== "GET" && req.headers.origin !== options.origin)
      return reply.code(403).send({ error: "アプリの画面から操作してください。" });
  });
  app.setErrorHandler((error, _req, reply) => {
    reportError(`http:${_req.method}:${_req.routeOptions.url}`, error);
    const e = error as Error & { statusCode?: number };
    reply
      .code(error instanceof z.ZodError ? 400 : e.statusCode || 500)
      .send({ error: error instanceof z.ZodError ? "入力内容を確認してください。" : e.message });
  });
  await app.register(websocket);
  app.get("/api/events", { websocket: true }, (socket, req) => {
    const owner = z
      .string()
      .uuid()
      .safeParse((req.query as { client?: string }).client);
    if (!owner.success || req.headers.origin !== options.origin) {
      socket.close(1008, "Invalid client");
      return;
    }
    clients.get(owner.data)?.close();
    clients.set(owner.data, socket);
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const timer = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 10_000);
    socket.on("message", (raw) => {
      try {
        const buffer = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw);
        const data = JSON.parse(buffer.toString("utf8"));
        if (data.type === "live.event" && typeof data.event === "object" && data.event)
          live.fromBrowser(owner.data, data.event);
      } catch (error) {
        reportError("events.client-message", error);
        socket.close(1003, "Invalid client event");
      }
    });
    socket.on("close", () => {
      clearInterval(timer);
      if (clients.get(owner.data) === socket) {
        clients.delete(owner.data);
        live.disconnected(owner.data);
      }
    });
    socket.on("error", () => {});
  });
  app.get("/api/status", status);
  app.post("/api/translations", async (req) => {
    const { requests, precision } = z
      .object({
        requests: z.array(translationRequestSchema).min(1).max(8),
        precision: translationPrecisionSchema.optional(),
      })
      .parse(req.body);
    const results = await Promise.allSettled(
      requests.map((r) => tutor.translator.translate(r, precision)),
    );
    const entries = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    // A missing translation must not hide the successful sentences in its batch.
    // Preserve the original error when the whole request failed (for example auth).
    const failure = results.find((result) => result.status === "rejected");
    if (!entries.length && failure) throw failure.reason;
    return { entries };
  });
  app.post("/api/auth/login", () => backend.login());
  app.post("/api/auth/logout", async () => {
    await backend.logout();
    return { ok: true };
  });
  app.post("/api/settings/translation", (req) => {
    const { precision } = z.object({ precision: translationPrecisionSchema }).parse(req.body);
    tutor.translator.setPrecision(precision);
    return { precision };
  });
  app.post("/api/settings/voice-key", async (req) => {
    if (live.info())
      throw Object.assign(new Error("会話を終了してからキーを変更してください。"), {
        statusCode: 409,
      });
    const { key } = z.object({ key: z.string().trim().min(10).max(1000) }).parse(req.body);
    writeFileSync(keyPath + ".tmp", key, { mode: 0o600 });
    renameSync(keyPath + ".tmp", keyPath);
    voiceKey = key;
    return { ok: true };
  });
  app.get("/api/lessons", () => store.list());
  app.get("/api/lessons/:id", (req) => store.get((req.params as { id: string }).id));
  app.get("/api/lessons/:id/recap", (req) => tutor.recap.read((req.params as { id: string }).id));
  app.post("/api/lessons/:id/recap", (req) => {
    const { retry = false } = z.object({ retry: z.boolean().optional() }).parse(req.body);
    return tutor.recap.ensure((req.params as { id: string }).id, retry);
  });
  app.post("/api/lessons/:id/finish", (req) => {
    const id = (req.params as { id: string }).id;
    if (live.info()?.lessonId === id)
      throw Object.assign(new Error("音声接続を終了してください。"), { statusCode: 409 });
    const lesson = store.get(id);
    if (lesson.kind !== "voice") throw new Error("会話のレッスンを指定してください。");
    store.status(id, "completed");
    const updated = tutor.recap.ensure(id);
    emit({ type: "lesson", lesson: updated });
    return updated;
  });
  app.post("/api/lessons/:id/recap/practice", (req) => {
    const { section, point } = z
      .object({ section: z.number().int().nonnegative(), point: z.number().int().nonnegative() })
      .parse(req.body);
    const id = (req.params as { id: string }).id;
    const lesson = tutor.recap.ensure(id);
    const chosen =
      lesson.recap?.status === "ready" ? lesson.recap.data?.sections[section]?.points[point] : null;
    if (!chosen) throw new Error("レッスンノートが更新されました。読み込み直してください。");
    const source = lesson.rows.find((r) => r.id === chosen.sourceId);
    if (chosen.kind !== "adjust" || source?.role !== "user")
      throw new Error("言い直す表現を選んでください。");
    const focus = store.learning.createFocus(id, {
      original: chosen.quote,
      suggestion: chosen.natural,
      reason: chosen.explanation,
    });
    const practice = store.create(
      "writing",
      directionFor(languageOf(lesson)),
      chosen.title,
      languageOf(lesson),
    );
    store.learning.attach(practice.id, focus.id, "retry");
    return store.get(practice.id);
  });
  app.post("/api/lookup", async (req) => {
    const { term, context, language } = z
      .object({
        term: z.string().trim().min(1).max(100),
        context: z.string().min(1).max(1500),
        language: languageSchema.default("id"),
      })
      .parse(req.body);
    if (!words(context, language).some((word) => normalizeWord(word.term) === normalizeWord(term)))
      throw Object.assign(new Error("本文内の単語を選んでください。"), { statusCode: 400 });
    return tutor.lookup(term, context, language);
  });
  app.post("/api/glossary/prepare", (req) => {
    const { requests, language } = z
      .object({
        language: languageSchema.default("id"),
        requests: z
          .array(
            z.object({ term: z.string().min(1).max(100), context: z.string().min(1).max(1500) }),
          )
          .max(40),
      })
      .parse(req.body);
    if (
      requests.some(
        (r) =>
          !words(r.context, language).some((w) => normalizeWord(w.term) === normalizeWord(r.term)),
      )
    )
      throw Object.assign(new Error("本文内の単語を選んでください。"), { statusCode: 400 });
    return tutor.glossaries[language].prepare(requests);
  });
  app.post("/api/practice", (req) => {
    const { focusId, mode, kind } = z
      .object({
        focusId: z.string().uuid(),
        mode: z.enum(["retry", "transfer"]),
        kind: z.enum(["voice", "writing"]),
      })
      .parse(req.body);
    const focus = store.learning.focus(focusId),
      source = store.get(focus.sourceLessonId);
    if (focus.state === "withdrawn") throw new Error("元の回答が変更されています。");
    store.db.exec("BEGIN");
    try {
      const lesson = store.create(kind, source.direction, source.topic, languageOf(source));
      store.learning.attach(lesson.id, focusId, mode);
      store.db.exec("COMMIT");
      return store.get(lesson.id);
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
  });
  app.post("/api/lessons/:id/hint", (req) => {
    const id = (req.params as { id: string }).id;
    return { hint: store.learning.hint(id), lesson: store.get(id) };
  });
  app.post("/api/lessons/:id/assistance", (req) => {
    const id = (req.params as { id: string }).id;
    store.learning.hint(id);
    return { ok: true };
  });
  app.post("/api/lessons/:id/reply-hints", (req) => {
    const id = (req.params as { id: string }).id;
    const { source } = z.object({ source: z.string().min(1).max(8000) }).parse(req.body);
    return once(`hints:${id}:${source}`, () => tutor.replyHints(id, source));
  });
  app.post("/api/lessons", async (req) => {
    const body = z
      .object({
        kind: z.enum(["voice", "writing"]),
        direction: directionSchema,
        language: languageSchema.optional(),
        topic: z.string().trim().max(500),
      })
      .parse(req.body);
    const lesson = store.create(
      body.kind,
      body.direction,
      body.topic || "仕事の説明",
      body.language,
    );
    emit({ type: "lesson", lesson });
    return lesson;
  });
  app.post("/api/lessons/:id/exercise", async (req) => {
    const l = store.get((req.params as { id: string }).id);
    return once(`exercise:${l.id}`, () => tutor.exercise(l.id, l.kind, l.direction, l.topic));
  });
  app.put("/api/lessons/:id/draft", (req) => {
    const { draft } = z.object({ draft: z.string().max(30_000) }).parse(req.body);
    return store.draft((req.params as { id: string }).id, draft);
  });
  app.post("/api/lessons/:id/evaluate", async (req) => {
    const { requestId, answer } = z
      .object({ requestId: z.string().uuid(), answer: z.string().max(30_000) })
      .parse(req.body);
    const id = (req.params as { id: string }).id,
      lesson = store.get(id);
    if (live.info()?.lessonId === id)
      throw Object.assign(new Error("会話を終了してから振り返りを作成してください。"), {
        statusCode: 409,
      });
    const text =
      lesson.kind === "voice"
        ? lesson.rows.map((r) => `${r.role}: ${r.corrected ?? r.original}`).join("\n")
        : answer;
    if (!text.trim())
      throw Object.assign(new Error("回答または会話の字幕が必要です。"), { statusCode: 400 });
    if (lesson.kind === "writing") store.draft(id, answer);
    return once(`evaluate:${id}:${requestId}`, async () => {
      const result = await tutor.evaluate(id, text, requestId);
      emit({ type: "lesson", lesson: result });
      return result;
    });
  });
  app.post("/api/lessons/:id/correct", async (req) => {
    const { rowId } = z.object({ rowId: z.string().uuid() }).parse(req.body);
    return tutor.correct((req.params as { id: string }).id, rowId);
  });
  app.post("/api/lessons/:id/speech-feedback/retry", (req) => {
    const { blockId } = z.object({ blockId: z.string().uuid() }).parse(req.body);
    const id = (req.params as { id: string }).id;
    tutor.speech.schedule(id, blockId);
    return { ok: true };
  });
  app.post("/api/lessons/:id/revise", (req) => {
    const { rowId, original, corrected } = z
      .object({
        rowId: z.string().uuid(),
        original: z.string().max(30_000),
        corrected: z.string().max(30_000),
      })
      .parse(req.body);
    const lesson = store.revise((req.params as { id: string }).id, rowId, original, corrected);
    tutor.speech.schedule(lesson.id);
    emit({ type: "lesson", lesson });
    return lesson;
  });
  app.post("/api/live/start", async (req) => {
    const { owner, lessonId, sdp } = z
      .object({
        owner: z.string().uuid(),
        lessonId: z.string().uuid(),
        sdp: z.string().min(10).max(100_000),
      })
      .parse(req.body);
    if (!clients.has(owner))
      throw new Error("字幕の接続が準備できていません。再読み込みしてください。");
    return live.start(owner, lessonId, sdp);
  });
  app.post("/api/live/stop", async (req) => {
    const { owner } = z.object({ owner: z.string().uuid() }).parse(req.body);
    if (live.info() && live.info()?.owner !== owner)
      throw Object.assign(new Error("会話を開始したウィンドウから終了してください。"), {
        statusCode: 409,
      });
    await live.stop();
    return { ok: true };
  });
  app.post("/api/live/pause", async (req) => {
    const { owner } = z.object({ owner: z.string().uuid() }).parse(req.body);
    return live.pause(owner);
  });
  app.addHook("onClose", async () => {
    tutor.translator.close();
    tutor.recap.close();
    tutor.speech.close();
    for (const glossary of Object.values(tutor.glossaries)) glossary.close();
    await live.stop("server_shutdown");
    for (const c of clients.values()) c.close();
    await backend.close();
    store.close();
  });
  return { app, store, tutor, live, status };
}
