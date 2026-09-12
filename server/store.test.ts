import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { feedback, exercise } from "./fixtures.test-helper.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  const lesson = store.create("voice", "ja-id", "仕事");
  return { store, id: lesson.id };
}
function part(event_id: string, delta: string, start_ms: number, end_ms: number, role = "user") {
  return {
    event_id,
    delta,
    start_ms,
    end_ms,
    type: role === "user" ? "session.input_transcript.delta" : "session.output_transcript.delta",
  };
}
describe("text history integrity", () => {
  it("does not move an old practice to the top just because it was reopened", () => {
    const { store, id } = setup();
    store.db.prepare("UPDATE lessons SET updated_at=1 WHERE id=?").run(id);
    store.draft(id, "");
    expect(store.get(id).updatedAt).toBe(1);
  });
  it("keeps overlapping speakers, repeated words, multilingual text and exact fragment spaces", () => {
    const { store, id } = setup();
    store.fragment(id, part("a", "Aku ", 0, 100));
    store.fragment(id, part("b", "えっと deadline 是明天？", 120, 500));
    store.fragment(id, part("c", "Iya, ", 250, 400, "assistant"));
    store.fragment(id, part("d", "iya.", 410, 600, "assistant"));
    expect(store.get(id).rows.map((r) => r.original)).toEqual([
      "Aku えっと deadline 是明天？",
      "Iya, iya.",
    ]);
  });
  it("deduplicates the same event arriving over data channel and sideband", () => {
    const { store, id } = setup(),
      e = part("same", "Halo", 0, 100);
    expect(store.fragment(id, e)).toBe(true);
    expect(store.fragment(id, e)).toBe(false);
    expect(store.get(id).rows[0].original).toBe("Halo");
  });
  it("inserts late fragments without replacing the display row identity", () => {
    const { store, id } = setup();
    store.fragment(id, part("later", " sibuk.", 400, 700));
    const before = store.get(id).rows[0];
    store.fragment(id, part("earlier", "Aku lagi", 0, 400));
    const after = store.get(id).rows[0];
    expect(after.id).toBe(before.id);
    expect(after.original).toBe("Aku lagi sibuk.");
  });
  it("keeps assistant text after an interruption and creates a resumed row", () => {
    const { store, id } = setup();
    store.fragment(id, part("a", "Jadi…", 0, 500, "assistant"));
    store.fragment(id, part("b", "ちょっと待って", 510, 700));
    store.fragment(id, part("c", "Ya?", 800, 900, "assistant"));
    expect(store.get(id).rows).toHaveLength(3);
    expect(store.get(id).rows[0].original).toBe("Jadi…");
  });
  it("preserves original speech and rejects corrections made against outdated text", () => {
    const { store, id } = setup();
    store.fragment(id, part("a", "saya sudah pergi besok", 0, 500));
    const row = store.get(id).rows[0];
    store.revise(id, row.id, row.original, "Saya sudah pergi besok");
    expect(store.get(id).rows[0].original).toBe("saya sudah pergi besok");
    store.fragment(id, part("b", " maybe", 500, 800));
    const updated = store.get(id).rows[0];
    expect(updated.corrected).toBeNull();
    expect(updated.revisionStale).toBe(true);
    expect(() => store.revise(id, row.id, row.original, "changed")).toThrow("字幕が更新");
  });
  it("counts cumulative voice snapshots once and honors final usage", () => {
    const { store, id } = setup();
    store.usageStart(id, "live_test");
    store.usage(id, 60);
    store.usage(id, 60);
    store.usage(id, 30);
    expect(store.monthUsage().seconds).toBe(60);
    store.usage(id, 65, true);
    store.usage(id, 100);
    expect(store.monthUsage()).toEqual({ seconds: 65, unconfirmed: 0 });
  });
  it("preserves an unanswered draft and both modality feedback after reopening SQLite", () => {
    const dir = mkdtempSync(join(tmpdir(), "bahasa-store-test-"));
    const path = join(dir, "test.sqlite");
    try {
      const s = new Store(path);
      const w = s.create("writing", "ja-id", "代案");
      s.exercise(w.id, exercise);
      s.draft(w.id, "Besok saya…");
      const v = s.create("voice", "ja-id", "依頼");
      s.feedback(v.id, "Saya sibuk", feedback, randomUUID());
      s.status(v.id, "active");
      s.close();
      const reopened = new Store(path);
      reopened.recover();
      expect(reopened.get(w.id).draft).toBe("Besok saya…");
      expect(reopened.get(v.id).attempts[0].feedback.nextFocus).toEqual(["依頼の理由を添える"]);
      expect(reopened.get(v.id).status).toBe("interrupted");
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("stores a retried evaluation once", () => {
    const { store, id } = setup();
    const requestId = randomUUID();
    store.feedback(id, "text", feedback, requestId);
    store.feedback(id, "text", feedback, requestId);
    expect(store.get(id).attempts).toHaveLength(1);
  });
});
