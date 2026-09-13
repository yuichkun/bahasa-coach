import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { Store } from "./store.ts";
import { ConversationGuide } from "./conversation.ts";
import { exercise } from "./fixtures.test-helper.ts";
let store: Store, guide: ConversationGuide;
beforeEach(() => {
  store = new Store(":memory:");
  guide = new ConversationGuide(store);
});
afterEach(() => store.close());
it("keeps the persona and story across microphone reconnects but varies new openings", () => {
  const a = store.create("voice", "ja-id", "自由会話");
  const first = guide.prepare(a.id);
  expect(first.instructions).toContain("fictional 29-year-old");
  expect(first.instructions).toContain("Questions are optional");
  expect(first.instructions).toContain("Dimas");
  store.status(a.id, "paused");
  guide = new ConversationGuide(store);
  expect(guide.prepare(a.id).story).toEqual(first.story);
  const b = store.create("voice", "ja-id", "自由会話");
  expect(guide.prepare(b.id).story?.topic).not.toBe(first.story?.topic);
});
it("remembers previous learner statements without treating old coach identities as Rani", () => {
  const old = store.create("voice", "ja-id", "自由会話");
  store.fragment(old.id, {
    event_id: "u",
    type: "session.input_transcript.delta",
    delta: "Aku tinggal di Tokyo.",
    start_ms: 0,
    end_ms: 1000,
  });
  store.fragment(old.id, {
    event_id: "a",
    type: "session.output_transcript.delta",
    delta: "My name is another coach.",
    start_ms: 1500,
    end_ms: 2500,
  });
  const next = store.create("voice", "ja-id", "自由会話");
  const result = guide.prepare(next.id);
  expect(result.instructions).toContain("Aku tinggal di Tokyo.");
  expect(result.instructions).not.toContain("My name is another coach.");
  expect(result.instructions).toContain("Do not restart with where the learner lives");
});
it("does not replace a guided exercise with an invented personal opening", () => {
  const lesson = store.create("voice", "ja-id", "依頼");
  store.exercise(lesson.id, exercise);
  expect(guide.prepare(lesson.id).story).toBeNull();
});

it("opens with a greeting and waiting, not the prepared personal anecdote", () => {
  const lesson = store.create("voice", "ja-id", "自由会話");
  const result = guide.prepare(lesson.id);
  expect(result.opening).toContain("short relaxed greeting");
  expect(result.opening).toContain("wait for the learner");
  expect(result.opening).not.toContain(result.story!.event);
  expect(result.instructions).toContain("not a request to tell the story now");
  expect(result.instructions).toContain("one or two short sentences");
  expect(result.instructions).toContain("do not fill it");
  expect(result.instructions).toContain("ちょっと待って");
});
