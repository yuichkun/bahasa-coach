import {
  translationKey,
  type TranslationEntry,
  type TranslationRequest,
} from "../shared/translation";
import {
  DEFAULT_TRANSLATION_PRECISION,
  type TranslationPrecision,
} from "../shared/translation-settings";
import { api } from "./api";
const cache = new Map<string, string>();
type Pending = {
  request: TranslationRequest;
  precision: TranslationPrecision;
  users: number;
  promise: Promise<string>;
  resolve: (s: string) => void;
  reject: (e: Error) => void;
};
const pending = new Map<string, Pending>(),
  queue = new Map<string, Pending>();
const running = new Set<TranslationPrecision>();
const storageKey = "bahasa.sentences.v2";
let loaded = false,
  timer: ReturnType<typeof setTimeout> | undefined,
  generation = 0;
function hydrate() {
  if (loaded) return;
  loaded = true;
  try {
    const saved =
      localStorage.getItem(storageKey) || localStorage.getItem("bahasa.sentences.v1") || "[]";
    for (const entry of JSON.parse(saved).slice(-160)) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
        cache.set(entry[0].replace(/^sentence-v1:/, "sentence-v2:balanced:"), entry[1]);
      }
    }
  } catch {}
}
function save() {
  while (cache.size > 160) cache.delete(cache.keys().next().value!);
  try {
    localStorage.setItem(storageKey, JSON.stringify([...cache]));
  } catch {}
}
export function peekTranslation(
  request: TranslationRequest,
  precision: TranslationPrecision = DEFAULT_TRANSLATION_PRECISION,
) {
  hydrate();
  return cache.get(translationKey(request, precision));
}
export function acquireTranslation(
  request: TranslationRequest,
  precision: TranslationPrecision = DEFAULT_TRANSLATION_PRECISION,
) {
  const key = translationKey(request, precision),
    hit = peekTranslation(request, precision);
  if (hit) return { promise: Promise.resolve(hit), release: () => {} };
  let entry = pending.get(key);
  if (!entry) {
    let resolve!: Pending["resolve"], reject!: Pending["reject"];
    const promise = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    entry = { request, precision, users: 0, promise, resolve, reject };
    pending.set(key, entry);
    queue.set(key, entry);
  }
  const current = entry;
  current.users++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    current.users--;
    if (!current.users && queue.get(key) === current) {
      queue.delete(key);
      pending.delete(key);
      current.reject(new Error("古い字幕の翻訳待ちを取り消しました。"));
    }
  };
  if (!timer)
    timer = setTimeout(() => {
      timer = undefined;
      drain();
    }, 20);
  return { promise: current.promise, release };
}
export function requestTranslation(
  request: TranslationRequest,
  precision: TranslationPrecision = DEFAULT_TRANSLATION_PRECISION,
) {
  const lease = acquireTranslation(request, precision);
  void lease.promise.then(lease.release, lease.release);
  return lease.promise;
}
function drain() {
  for (const precision of new Set([...queue.values()].map((job) => job.precision))) {
    if (running.has(precision)) continue;
    running.add(precision);
    const version = generation;
    void flush(precision, version).finally(() => {
      if (version === generation) {
        running.delete(precision);
        drain();
      }
    });
  }
}
async function flush(precision: TranslationPrecision, version: number) {
  while (version === generation) {
    const batch = [...queue.entries()].filter(([, job]) => job.precision === precision).slice(0, 4);
    if (!batch.length) return;
    batch.forEach(([key]) => queue.delete(key));
    try {
      const result = await api<{ entries: TranslationEntry[] }>("/translations", {
        precision,
        requests: batch.map(([, p]) => p.request),
      });
      if (version !== generation) return;
      for (const [key, job] of batch) {
        const value = result.entries?.find((e) => e.key === key)?.translation;
        if (!value?.trim()) throw new Error("文の訳を取得できませんでした。");
        cache.set(key, value);
        job.resolve(value);
      }
      save();
    } catch (error) {
      for (const [, job] of batch) job.reject(error as Error);
    } finally {
      for (const [key, job] of batch) if (pending.get(key) === job) pending.delete(key);
    }
  }
}
export function clearTranslationCache() {
  generation++;
  cache.clear();
  queue.clear();
  pending.clear();
  running.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
  loaded = false;
  try {
    localStorage.removeItem(storageKey);
    localStorage.removeItem("bahasa.sentences.v1");
  } catch {}
}
