import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.ts";
import { FakeBackend } from "./fixtures.test-helper.ts";
import { Translator } from "./translation.ts";
import { sentenceRequest, translationKey, type TranslationRequest } from "../shared/translation.ts";
let store: Store, backend: FakeBackend, translator: Translator;
const request: TranslationRequest = {
  sentence: "Aku nggak enak.",
  speaker: "assistant",
  before: [{ role: "assistant", text: "Badanku pegal dan kepalaku pusing." }],
  after: [{ role: "assistant", text: "Aku mau istirahat dulu." }],
};
beforeEach(() => {
  vi.useFakeTimers();
  store = new Store(":memory:");
  backend = new FakeBackend();
  translator = new Translator(store, backend);
  backend.result = { entries: [{ id: "0", translation: "具合がよくないんだ。" }] };
});
afterEach(() => {
  translator.close();
  store.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("translates with both surrounding turns and coalesces requests for the same sentence", async () => {
  const a = translator.translate(request),
    b = translator.translate(request);
  await vi.advanceTimersByTimeAsync(25);
  expect(await a).toEqual(await b);
  expect(backend.calls).toHaveLength(1);
  const data = JSON.parse(backend.calls[0].split("DATA:\n")[1]);
  expect(data[0].before).toEqual(request.before);
  expect(data[0].after).toEqual(request.after);
  await translator.translate(request);
  expect(backend.calls).toHaveLength(1);
});
it("does not reuse a translation when the same sentence has different surrounding meaning", async () => {
  const first = translator.translate(request);
  await vi.advanceTimersByTimeAsync(25);
  await first;
  const different = {
    ...request,
    before: [{ role: "user" as const, text: "Dimas sudah masak, tapi kamu mau pulang?" }],
    after: [],
  };
  backend.result = { entries: [{ id: "0", translation: "気が引けるんだ。" }] };
  const second = translator.translate(different);
  await vi.advanceTimersByTimeAsync(25);
  expect((await second).translation).toBe("気が引けるんだ。");
  expect(backend.calls).toHaveLength(2);
  expect(translationKey({ ...request, sentence: "Aku nggak enak?" })).not.toBe(
    translationKey(request),
  );
});
it("selects a complete sentence and includes its neighboring sentences and conversation", () => {
  const text = "Dimas masak. Aku nggak enak. Tapi aku perlu pulang.";
  const selected = sentenceRequest(text, text.indexOf("nggak"), {
    speaker: "assistant",
    before: [{ role: "user", text: "Kenapa?" }],
    after: [{ role: "user", text: "Oh, begitu." }],
  })!;
  expect(selected.sentence).toBe("Aku nggak enak.");
  expect(selected.before.map((t) => t.text)).toEqual(["Kenapa?", "Dimas masak."]);
  expect(selected.after.map((t) => t.text)).toEqual(["Tapi aku perlu pulang.", "Oh, begitu."]);
});
it("allows retry after missing model results and never caches a failed translation", async () => {
  backend.result = { entries: [] };
  const failed = expect(translator.translate(request)).rejects.toThrow("文の訳");
  await vi.advanceTimersByTimeAsync(25);
  await failed;
  backend.result = { entries: [{ id: "0", translation: "具合がよくないんだ。" }] };
  const next = translator.translate(request);
  await vi.advanceTimersByTimeAsync(25);
  expect((await next).translation).toBe("具合がよくないんだ。");
});
it("restores contextual translations from SQLite after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bahasa-translation-")),
    path = join(dir, "cache.sqlite");
  translator.close();
  store.close();
  store = new Store(path);
  translator = new Translator(store, backend);
  const job = translator.translate(request);
  await vi.advanceTimersByTimeAsync(25);
  await job;
  translator.close();
  store.close();
  store = new Store(path);
  translator = new Translator(store, backend);
  expect((await translator.translate(request)).translation).toBe("具合がよくないんだ。");
  expect(backend.calls).toHaveLength(1);
  translator.close();
  store.close();
  store = new Store(":memory:");
  rmSync(dir, { recursive: true, force: true });
});
