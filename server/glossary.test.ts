import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.ts";
import { Glossary } from "./glossary.ts";
import { FakeBackend } from "./fixtures.test-helper.ts";
import { glossKey, wordContext } from "../shared/glossary.ts";
let store: Store, backend: FakeBackend, glossary: Glossary;
beforeEach(() => {
  store = new Store(":memory:");
  backend = new FakeBackend();
  glossary = new Glossary(store, backend);
});
afterEach(() => {
  glossary.close();
  store.close();
});
describe("dictionary prefetch and persistent cache", () => {
  it("returns known entries without waiting for an unrelated missing definition", async () => {
    backend.result = { term: "jadwal", meaning: "予定", formal: "jadwal", note: "" };
    await glossary.lookup("jadwal", "Jadwal rapat berubah.");
    const update = glossary.prepare([
      { term: "jadwal", context: "Jadwal rapat berubah." },
      { term: "menyelaraskan", context: "Kita menyelaraskan jadwal." },
    ]);
    expect(update.entries[0].annotation.meaning).toBe("予定");
    expect(update.pending).toHaveLength(1);
    expect(backend.calls).toHaveLength(1);
  });
  it("returns cached/common definitions immediately and batches missing words once", async () => {
    backend.requestJson = async (prompt) => {
      backend.calls.push(prompt);
      const data = JSON.parse(prompt.split("DATA:\n")[1]);
      const meanings: Record<string, string> = { menunda: "延期する", rapat: "会議" };
      return {
        entries: data.items.map((item: { id: string; term: string }) => ({
          id: item.id,
          meaning: meanings[item.term],
          formal: item.term,
          note: "",
        })),
        vocabulary: [
          { term: "menunda", meaning: "延期する", formal: "menunda", note: "" },
          { term: "rapat", meaning: "会議／密接な", formal: "rapat", note: "" },
        ],
      };
    };
    const ready = vi.fn();
    glossary.onReady = ready;
    const requests = [
      { term: "aku", context: "Aku menunda rapat." },
      { term: "menunda", context: "Aku menunda rapat." },
      { term: "rapat", context: "Aku menunda rapat." },
    ];
    const first = glossary.prepare(requests);
    expect(backend.calls).toHaveLength(0);
    expect(first.vocabulary[0].term).toBe("aku");
    expect(first.pending).toHaveLength(2);
    const hover = glossary.lookup("rapat", "Aku menunda rapat.");
    await vi.waitFor(() => expect(ready).toHaveBeenCalled());
    expect((await hover).meaning).toBe("会議");
    expect(backend.calls).toHaveLength(1);
    const next = glossary.prepare(requests);
    expect(next.entries).toHaveLength(2);
    expect(next.pending).toHaveLength(0);
    expect(backend.calls).toHaveLength(1);
  });
  it("normalizes harmless whitespace, capitalization and terminal punctuation", async () => {
    backend.result = { term: "menunda", meaning: "延期する", formal: "menunda", note: "" };
    await glossary.lookup("menunda", "Kita perlu menunda rapat.");
    await glossary.lookup("Menunda", "  KITA   perlu menunda rapat! ");
    expect(backend.calls).toHaveLength(1);
  });
  it("does not carry a selected polysemous sense into a different context", async () => {
    backend.result = { term: "bisa", meaning: "できる", formal: "bisa", note: "" };
    await glossary.lookup("bisa", "Aku bisa datang.");
    backend.result = {
      entries: [{ id: "0", meaning: "毒", formal: "bisa", note: "" }],
      vocabulary: [],
    };
    const next = glossary.prepare([{ term: "bisa", context: "Bisa ular itu berbahaya." }]);
    expect(next.entries).toHaveLength(0);
    expect(next.vocabulary[0].meaning).toContain("毒");
    expect((await glossary.lookup("bisa", "Bisa ular itu berbahaya.")).meaning).toBe("毒");
    expect(backend.calls).toHaveLength(2);
  });
  it("keeps two occurrences with different senses in one sentence distinct", () => {
    const text = "Bisa itu bisa membunuh.";
    const first = wordContext(text, 0),
      second = wordContext(text, 9);
    expect(first).toContain("⟦Bisa⟧");
    expect(second).toContain("⟦bisa⟧");
    expect(glossKey("bisa", first)).not.toBe(glossKey("bisa", second));
  });
  it("reuses the SQLite cache after restarting the service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bahasa-glossary-"));
    const path = join(dir, "cache.sqlite");
    const db = new Store(path),
      service = new Glossary(db, backend);
    backend.result = { term: "jadwal", meaning: "予定", formal: "jadwal", note: "" };
    await service.lookup("jadwal", "Jadwal rapat berubah.");
    service.close();
    db.close();
    const reopened = new Store(path),
      again = new Glossary(reopened, backend);
    backend.failure = new Error("provider offline");
    expect((await again.lookup("Jadwal", "Jadwal rapat berubah!")).meaning).toBe("予定");
    again.close();
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });
  it("does not permanently cache a failed or omitted batch result", async () => {
    backend.result = { entries: [], vocabulary: [] };
    const ready = vi.fn();
    glossary.onReady = ready;
    glossary.prepare([{ term: "rapat", context: "Ada rapat." }]);
    await vi.waitFor(() => expect(ready).toHaveBeenCalled());
    backend.result = { term: "rapat", meaning: "会議", formal: "rapat", note: "" };
    expect((await glossary.lookup("rapat", "Ada rapat.")).meaning).toBe("会議");
    expect(backend.calls).toHaveLength(2);
  });
});
