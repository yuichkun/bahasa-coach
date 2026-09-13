import {
  translationKey,
  type TranslationEntry,
  type TranslationRequest,
} from "../shared/translation";
import { api } from "./api";
const cache = new Map<string, string>();
type Pending = {
  request: TranslationRequest;
  promise: Promise<string>;
  resolve: (s: string) => void;
  reject: (e: Error) => void;
};
const pending = new Map<string, Pending>(),
  queue = new Map<string, Pending>();
const storageKey = "bahasa.sentences.v1";
let loaded = false,
  timer: ReturnType<typeof setTimeout> | undefined,
  running = false;
function hydrate() {
  if (loaded) return;
  loaded = true;
  try {
    for (const entry of JSON.parse(localStorage.getItem(storageKey) || "[]").slice(-160))
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string")
        cache.set(entry[0], entry[1]);
  } catch {}
}
function save() {
  while (cache.size > 160) cache.delete(cache.keys().next().value!);
  try {
    localStorage.setItem(storageKey, JSON.stringify([...cache]));
  } catch {}
}
export function peekTranslation(request: TranslationRequest) {
  hydrate();
  return cache.get(translationKey(request));
}
export function requestTranslation(request: TranslationRequest): Promise<string> {
  const key = translationKey(request),
    hit = peekTranslation(request);
  if (hit) return Promise.resolve(hit);
  const prior = pending.get(key);
  if (prior) return prior.promise;
  let resolve!: Pending["resolve"], reject!: Pending["reject"];
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const entry = { request, promise, resolve, reject };
  pending.set(key, entry);
  queue.set(key, entry);
  if (!running && !timer)
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, 40);
  return promise;
}
async function flush() {
  if (running) return;
  running = true;
  try {
    while (queue.size) {
      const batch = [...queue.entries()].slice(0, 4);
      batch.forEach(([key]) => queue.delete(key));
      try {
        const result = await api<{ entries: TranslationEntry[] }>("/translations", {
          requests: batch.map(([, p]) => p.request),
        });
        for (const [key, job] of batch) {
          const value = result.entries?.find((e) => e.key === key)?.translation;
          if (!value?.trim()) throw new Error("文の訳を取得できませんでした。");
          cache.set(key, value);
          job.resolve(value);
        }
        save();
      } catch (error) {
        for (const [, job] of batch) {
          job.reject(error as Error);
        }
      } finally {
        batch.forEach(([key]) => pending.delete(key));
      }
    }
  } finally {
    running = false;
  }
}
export function clearTranslationCache() {
  cache.clear();
  queue.clear();
  pending.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
  loaded = false;
  try {
    localStorage.removeItem(storageKey);
  } catch {}
}
