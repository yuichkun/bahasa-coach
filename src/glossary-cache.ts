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
  listeners = new Set<() => void>();
const sources = new Map<string, { text: string; streaming: boolean; changed: number }>();
const STORAGE = "bahasa.glossary.v2";
let revision = 0,
  epoch = 0,
  hydrated = false,
  saveTimer: ReturnType<typeof setTimeout> | null = null,
  warmTimer: ReturnType<typeof setTimeout> | null = null,
  preparing = false;
function valid(a: unknown): a is Annotation {
  return Boolean(
    a &&
    typeof a === "object" &&
    ["term", "meaning", "formal", "note"].every(
      (k) => typeof (a as Record<string, unknown>)[k] === "string",
    ) &&
    String((a as Record<string, unknown>).meaning).trim(),
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
export function glossaryRevision() {
  return revision;
}
function notify() {
  revision++;
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
  const now = Date.now(),
    generation = epoch;
  requests.forEach((r) => pending.set(glossKey(r.term, r.context), now + 30_000));
  try {
    const result = await api<GlossUpdate>("/glossary/prepare", { requests });
    if (generation === epoch) ingestGlossary(result);
  } catch {
    if (generation !== epoch) return;
    requests.forEach((r) => {
      const key = glossKey(r.term, r.context);
      pending.delete(key);
      failures.set(key, Date.now() + 30_000);
    });
  }
}
function nextRetryDelay() {
  const now = Date.now();
  const times = [...pending.values(), ...failures.values()].filter((time) => time > now);
  return times.length ? Math.max(50, Math.min(...times) - now) : Infinity;
}
async function flushWarm() {
  if (preparing || !sources.size) return;
  const now = Date.now();
  const active = [...pending.values()].filter((time) => time > now).length;
  if (active >= 36) {
    scheduleWarm(nextRetryDelay());
    return;
  }
  const requests = new Map<string, GlossRequest>();
  let nextWake = nextRetryDelay();
  for (const source of [...sources.values()].reverse()) {
    const idle = now - source.changed;
    for (const span of sentenceContexts(source.text)) {
      const partial = source.streaming && !span.complete;
      let context = span.text;
      if (partial && idle < 350) {
        // The trailing token may still be arriving. Earlier whole words can be prepared now.
        const lastWord = words(context).at(-1);
        if (lastWord) context = context.slice(0, lastWord.index).trim();
        nextWake = Math.min(nextWake, 350 - idle);
      }
      for (const word of words(context)) {
        const request = {
          term: word.term,
          context: selectionContext(context, word.term, word.index),
        };
        if (partial) {
          // General definitions are reusable while a sentence is growing. Resolve its
          // specific senses once complete, without looking up every evolving prefix.
          const prefix = normalizeWord(word.term) + "\n";
          if (
            peekMeaning(word.term, request.context) ||
            [...pending, ...failures].some(
              ([key, until]) => key.startsWith(prefix) && until > now,
            ) ||
            [...requests.keys()].some((key) => key.startsWith(prefix))
          )
            continue;
        }
        if (needs(request)) requests.set(glossKey(word.term, request.context), request);
      }
    }
  }
  if (!requests.size) {
    if (Number.isFinite(nextWake)) scheduleWarm(Math.max(50, nextWake));
    return;
  }
  const generation = epoch;
  preparing = true;
  try {
    const prioritized = [...requests.values()].sort(
      (a, b) =>
        Number(Boolean(peekMeaning(a.term, a.context))) -
        Number(Boolean(peekMeaning(b.term, b.context))),
    );
    await prepare(prioritized.slice(0, 36 - active));
  } finally {
    if (generation === epoch) {
      preparing = false;
      scheduleWarm();
    }
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
export function clearGlossCache(preserveStorage = false) {
  contexts.clear();
  vocabulary.clear();
  pending.clear();
  failures.clear();
  epoch++;
  preparing = false;
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
  notify();
}
