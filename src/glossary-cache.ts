import type { Annotation } from "../shared/types";
import {
  basicGloss,
  glossKey,
  normalizeWord,
  sentenceContexts,
  selectionContext,
  words,
  type GlossEntry,
  type GlossRequest,
  type GlossUpdate,
  type GlossValue,
} from "../shared/glossary";
import { api } from "./api";

const contexts = new Map<string, GlossEntry>(),
  vocabulary = new Map<string, Annotation>(),
  pending = new Map<string, number>(),
  failures = new Map<string, number>(),
  foreground = new Map<string, Promise<GlossValue>>(),
  listeners = new Set<() => void>();
const sources = new Map<string, { text: string; streaming: boolean; changed: number }>();
const STORAGE = "bahasa.glossary.v2";
let hydrated = false,
  saveTimer: ReturnType<typeof setTimeout> | null = null,
  warmTimer: ReturnType<typeof setTimeout> | null = null,
  preparing = false;
function valid(a: unknown): a is Annotation {
  return Boolean(
    a &&
    typeof a === "object" &&
    ["term", "meaning", "formal", "note"].every(
      (k) => typeof (a as Record<string, unknown>)[k] === "string",
    ),
  );
}
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) || "null");
    for (const entry of (data?.entries || []).slice(-1200))
      if (
        typeof entry.context === "string" &&
        typeof entry.term === "string" &&
        valid(entry.annotation)
      )
        contexts.set(glossKey(entry.term, entry.context), entry);
    for (const a of (data?.vocabulary || []).slice(-750))
      if (valid(a)) vocabulary.set(normalizeWord(a.term), a);
  } catch {
    /* Storage is optional; SQLite remains the persistent source. */
  }
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({
          entries: [...contexts.values()].slice(-1200),
          vocabulary: [...vocabulary.values()].slice(-750),
        }),
      );
    } catch {}
  }, 200);
}
function notify() {
  listeners.forEach((fn) => fn());
}
export function subscribeGlossary(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function peekMeaning(term: string, context: string): GlossValue | null {
  hydrate();
  const exact = contexts.get(glossKey(term, context));
  if (exact) return { ...exact.annotation, scope: "context" };
  const general = basicGloss(term)?.annotation || vocabulary.get(normalizeWord(term));
  return general ? { ...general, term, scope: "general" } : null;
}
export function ingestGlossary(update: GlossUpdate) {
  hydrate();
  for (const e of update.entries || [])
    if (valid(e.annotation)) {
      const key = glossKey(e.term, e.context);
      contexts.set(key, e);
      pending.delete(key);
      failures.delete(key);
    }
  for (const a of update.vocabulary || []) if (valid(a)) vocabulary.set(normalizeWord(a.term), a);
  for (const key of update.pending || [])
    if (!contexts.has(key)) pending.set(key, Date.now() + 30_000);
  for (const key of update.failed || []) {
    pending.delete(key);
    failures.set(key, Date.now() + 30_000);
  }
  while (contexts.size > 1200) contexts.delete(contexts.keys().next().value!);
  while (vocabulary.size > 750) vocabulary.delete(vocabulary.keys().next().value!);
  save();
  notify();
  scheduleWarm();
}
export function seedAnnotations(text: string, annotations: Annotation[]) {
  if (!annotations.length) return;
  hydrate();
  const counts = new Map<string, number>();
  for (const w of words(text))
    counts.set(normalizeWord(w.term), (counts.get(normalizeWord(w.term)) || 0) + 1);
  const map = new Map(
    annotations
      .filter((a) => counts.get(normalizeWord(a.term)) === 1)
      .map((a) => [normalizeWord(a.term), a]),
  );
  const entries: GlossEntry[] = [];
  for (const span of sentenceContexts(text))
    for (const word of words(span.text)) {
      const annotation = map.get(normalizeWord(word.term));
      if (annotation && !contexts.has(glossKey(word.term, span.text)))
        entries.push({ term: word.term, context: span.text, annotation });
    }
  if (entries.length) ingestGlossary({ entries, vocabulary: [] });
}
function needs(request: GlossRequest) {
  const key = glossKey(request.term, request.context),
    now = Date.now();
  return (
    request.term.length <= 100 &&
    request.context.length <= 1500 &&
    !contexts.has(key) &&
    !basicGloss(request.term)?.stable &&
    (pending.get(key) || 0) < now &&
    (failures.get(key) || 0) < now
  );
}
function scheduleWarm(delay = 120) {
  if (warmTimer || !sources.size) return;
  warmTimer = setTimeout(() => {
    warmTimer = null;
    void flushWarm();
  }, delay);
}
async function prepare(requests: GlossRequest[]) {
  const now = Date.now();
  requests.forEach((r) => pending.set(glossKey(r.term, r.context), now + 30_000));
  try {
    const result = await api<GlossUpdate>("/glossary/prepare", { requests });
    ingestGlossary(result);
  } catch {
    requests.forEach((r) => {
      const key = glossKey(r.term, r.context);
      pending.delete(key);
      failures.set(key, Date.now() + 30_000);
    });
  }
}
async function flushWarm() {
  if (preparing) return;
  const active = [...pending.values()].filter((time) => time > Date.now()).length;
  if (active >= 36) return;
  const requests = new Map<string, GlossRequest>();
  let idleWait = Infinity;
  for (const source of [...sources.values()].reverse()) {
    const idle = Date.now() - source.changed;
    for (const span of sentenceContexts(source.text)) {
      if (source.streaming && !span.complete && idle < 800) {
        idleWait = Math.min(idleWait, 800 - idle);
        continue;
      }
      for (const word of words(span.text)) {
        const request = {
          term: word.term,
          context: selectionContext(span.text, word.term, word.index),
        };
        if (needs(request)) requests.set(glossKey(word.term, span.text), request);
        if (requests.size >= 36 - active) break;
      }
      if (requests.size >= 36 - active) break;
    }
    if (requests.size >= 36 - active) break;
  }
  if (!requests.size) {
    if (Number.isFinite(idleWait)) scheduleWarm(Math.max(100, idleWait));
    return;
  }
  preparing = true;
  try {
    await prepare([...requests.values()]);
  } finally {
    preparing = false;
    scheduleWarm();
  }
}
export function warmGlossarySource(id: string, text: string, streaming = false) {
  hydrate();
  sources.delete(id);
  sources.set(id, { text, streaming, changed: Date.now() });
  if (
    sentenceContexts(text).some(
      (s) =>
        s.complete &&
        words(s.text).some((w) =>
          needs({ term: w.term, context: selectionContext(s.text, w.term, w.index) }),
        ),
    )
  ) {
    if (warmTimer) clearTimeout(warmTimer);
    warmTimer = null;
    scheduleWarm(30);
  } else scheduleWarm();
  return () => {
    sources.delete(id);
  };
}
export function resumeGlossaryPrefetch() {
  pending.clear();
  scheduleWarm();
}
export async function requestMeaning(term: string, context: string): Promise<GlossValue> {
  hydrate();
  const key = glossKey(term, context),
    ready = peekMeaning(term, context);
  if (ready) {
    if (ready.scope === "general" && needs({ term, context })) void prepare([{ term, context }]);
    return ready;
  }
  const existing = foreground.get(key);
  if (existing) return existing;
  const promise = api<Annotation>("/lookup", { term, context })
    .then((annotation) => {
      ingestGlossary({ entries: [{ term, context, annotation }], vocabulary: [] });
      return { ...annotation, scope: "context" as const };
    })
    .finally(() => foreground.delete(key));
  foreground.set(key, promise);
  return promise;
}
export function clearGlossCache(preserveStorage = false) {
  contexts.clear();
  vocabulary.clear();
  pending.clear();
  failures.clear();
  foreground.clear();
  sources.clear();
  hydrated = false;
  if (saveTimer) clearTimeout(saveTimer);
  if (warmTimer) clearTimeout(warmTimer);
  saveTimer = null;
  warmTimer = null;
  if (!preserveStorage)
    try {
      localStorage.removeItem(STORAGE);
    } catch {}
}
