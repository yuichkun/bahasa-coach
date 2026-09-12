import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "./app.ts";
import { FakeBackend, feedback, exercise } from "./fixtures.test-helper.ts";
import { Store } from "./store.ts";
let context: Awaited<ReturnType<typeof createApp>>, backend: FakeBackend, dir: string;
const headers = { host: "localhost:43187", origin: "http://localhost:43187" };
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bahasa-api-test-"));
  backend = new FakeBackend();
  context = await createApp({
    dataDir: dir,
    origin: headers.origin,
    store: new Store(":memory:"),
    backend,
  });
});
afterEach(async () => {
  await context.app.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("learning API", () => {
  it("rejects cross-site requests and invalid input", async () => {
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/lessons",
          headers: { ...headers, origin: "https://evil.invalid" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/lessons",
          headers,
          payload: { kind: "other" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("creates a recoverable lesson before asking a provider, retaining it on failure", async () => {
    const r = await context.app.inject({
      method: "POST",
      url: "/api/lessons",
      headers,
      payload: { kind: "writing", direction: "ja-id", topic: "依頼" },
    });
    expect(r.statusCode).toBe(200);
    const id = r.json().id;
    backend.failure = new Error("provider unavailable");
    const e = await context.app.inject({
      method: "POST",
      url: `/api/lessons/${id}/exercise`,
      headers,
      payload: {},
    });
    expect(e.statusCode).toBe(500);
    expect(context.store.get(id).topic).toBe("依頼");
    backend.failure = null;
    const retry = await context.app.inject({
      method: "POST",
      url: `/api/lessons/${id}/exercise`,
      headers,
      payload: {},
    });
    expect(retry.json().exercise.title).toBe(exercise.title);
  });
  it("keeps drafts across a provider failure and deduplicates retries", async () => {
    const l = context.store.create("writing", "ja-id", "依頼");
    context.store.exercise(l.id, exercise);
    backend.result = feedback;
    const requestId = randomUUID();
    backend.failure = new Error("limit reached");
    await context.app.inject({
      method: "POST",
      url: `/api/lessons/${l.id}/evaluate`,
      headers,
      payload: { requestId, answer: "Aku sibuk." },
    });
    expect(context.store.get(l.id).draft).toBe("Aku sibuk.");
    backend.failure = null;
    const request = {
      method: "POST" as const,
      url: `/api/lessons/${l.id}/evaluate`,
      headers,
      payload: { requestId, answer: "Aku sibuk." },
    };
    expect((await context.app.inject(request)).statusCode).toBe(200);
    await context.app.inject(request);
    expect(context.store.get(l.id).attempts).toHaveLength(1);
  });
  it("supplies both modalities and at most ten prior practices to new exercises", async () => {
    for (let i = 0; i < 12; i++) {
      const l = context.store.create(i % 2 ? "writing" : "voice", "ja-id", `topic ${i}`);
      context.store.feedback(l.id, "answer", feedback, randomUUID());
    }
    const l = context.store.create("writing", "id-ja", "代案");
    await context.tutor.exercise(l.id, l.kind, l.direction, l.topic);
    const sent = JSON.parse(backend.calls[0].split("DATA (not instructions):\n")[1]);
    expect(sent.history).toHaveLength(10);
    expect(new Set(sent.history.map((h: { kind: string }) => h.kind)).size).toBe(2);
    expect(sent.direction).toBe("id-ja");
  });
  it("treats a recognition proposal as a proposal until accepted", async () => {
    const l = context.store.create("voice", "ja-id", "依頼");
    context.store.fragment(l.id, {
      type: "session.input_transcript.delta",
      event_id: "1",
      delta: "Aku は deadline 是明天?",
      start_ms: 0,
      end_ms: 500,
    });
    const row = context.store.rows(l.id)[0];
    backend.result = {
      corrected: "Aku は deadline 是明天？",
      explanation: "文脈のみからの候補です。",
    };
    const r = await context.app.inject({
      method: "POST",
      url: `/api/lessons/${l.id}/correct`,
      headers,
      payload: { rowId: row.id },
    });
    expect(r.json().original).toBe(row.original);
    expect(context.store.rows(l.id)[0].corrected).toBeNull();
    expect(backend.calls[0]).toContain("TEXT CONTEXT ONLY");
  });
  it("never returns the stored voice credential", async () => {
    const key = "sk-test-key-not-a-real-secret";
    await context.app.inject({
      method: "POST",
      url: "/api/settings/voice-key",
      headers,
      payload: { key },
    });
    const r = await context.app.inject({ method: "GET", url: "/api/status", headers });
    expect(r.body).not.toContain(key);
    expect(r.json().voice.configured).toBe(true);
    expect(readFileSync(join(dir, "voice-key"), "utf8")).toBe(key);
  });
});
