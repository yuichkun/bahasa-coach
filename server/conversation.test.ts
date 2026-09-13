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
  expect(first.instructions).toContain("fiktif berusia 29");
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
  expect(result.instructions).toContain("Jangan mengulang wawancara tempat tinggal/pekerjaan");
});
it("does not replace a guided exercise with an invented personal opening", () => {
  const lesson = store.create("voice", "ja-id", "依頼");
  store.exercise(lesson.id, exercise);
  expect(guide.prepare(lesson.id).story).toBeNull();
});

it("opens with a light concrete hook and develops completed short replies", () => {
  const lesson = store.create("voice", "ja-id", "自由会話");
  const result = guide.prepare(lesson.id);
  expect(result.opening).toContain(result.story!.openingHook);
  expect(result.instructions).toContain(result.story!.detailToExplore);
  expect(result.opening).not.toContain(result.story!.detailToExplore);
  expect(result.instructions).toContain("Pelajar boleh menjawab pendek");
  expect(result.instructions).toContain('"aku juga"');
  expect(result.instructions).toContain("satu atau dua kalimat");
  expect(result.instructions).toContain("Jangan mengisi jeda berpikir");
  expect(result.instructions).toContain("satu hal BARU");
  expect(result.instructions).toContain("ちょっと待って");
  expect(result.instructions).not.toContain(
    "A listening acknowledgment is not a request for a new topic",
  );
});
it("does not feed repetitive old coach openings back as response examples", () => {
  const old = store.create("voice", "ja-id", "自由会話");
  guide.prepare(old.id);
  store.fragment(old.id, {
    event_id: "user",
    type: "session.input_transcript.delta",
    delta: "Aku tinggal di Tokyo.",
    start_ms: 0,
    end_ms: 500,
  });
  store.fragment(old.id, {
    event_id: "coach",
    type: "session.output_transcript.delta",
    delta: "Lagi rehat sebentar nih dari kerjaan.",
    start_ms: 700,
    end_ms: 1300,
  });
  const next = store.create("voice", "ja-id", "自由会話");
  const result = guide.prepare(next.id);
  expect(result.instructions).toContain("Aku tinggal di Tokyo.");
  expect(result.instructions).not.toContain("Lagi rehat sebentar nih dari kerjaan.");
});
it("uses a gentle bridge for a previously saved relationship story", () => {
  const lesson = store.create("voice", "ja-id", "自由会話");
  const legacy = {
    topic: "weekend plans with Dimas",
    event: "A private disagreement with Dimas.",
    feeling: "annoyed",
  };
  store.db
    .prepare("INSERT INTO conversation_stories VALUES(?,?)")
    .run(lesson.id, JSON.stringify(legacy));
  const result = guide.prepare(lesson.id);
  expect(result.story).toEqual(legacy);
  expect(result.opening).toContain("a lively cafe versus a quiet walk");
  expect(result.opening).not.toContain(legacy.event);
  expect(result.instructions).not.toContain(legacy.event);
});
