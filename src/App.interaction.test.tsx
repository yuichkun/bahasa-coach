// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import App from "./App";
import { GlossProvider } from "./Gloss";
import type { Lesson, LiveInfo } from "../shared/types";
import { LANGUAGE, directionFor, type Language } from "../shared/languages";
const mocks = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn(),
  pause: vi.fn(),
  active: null as LiveInfo | null,
  owner: "",
  sockets: [] as any[],
}));
vi.mock("./voice", () => ({
  VoiceClient: class {
    constructor(owner: string) {
      mocks.owner = owner;
    }
    start = mocks.start;
    cleanup = mocks.cleanup;
    stop = vi.fn().mockResolvedValue(undefined);
    pause = mocks.pause;
  },
}));
const free: Lesson = {
  id: "free-test",
  kind: "voice",
  direction: "ja-id",
  topic: "自由会話",
  title: "自由会話",
  exercise: null,
  draft: "",
  status: "draft",
  createdAt: 1,
  updatedAt: 1,
  rows: [],
  attempts: [],
};
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  mocks.start.mockReset().mockResolvedValue(undefined);
  mocks.sockets = [];
  mocks.active = null;
  mocks.pause.mockReset();
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      onopen: any;
      onmessage: any;
      onclose: any;
      onerror: any;
      constructor() {
        mocks.sockets.push(this);
        queueMicrotask(() => this.onopen?.());
      }
      send() {}
      close() {
        this.onclose?.();
      }
    },
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    if (
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith("/status")
    )
      return new Response(
        JSON.stringify({
          chatgpt: { connected: true, email: null, plan: "pro", pending: false, error: null },
          voice: {
            configured: true,
            active: mocks.active,
            monthSeconds: 0,
            unconfirmed: 0,
            pricePerMinute: 0.05,
          },
        }),
      );
    if (
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith(
        "/lessons",
      ) &&
      options?.method === "POST"
    )
      return new Response(JSON.stringify(free));
    if (
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes("/recap")
    )
      return new Response(
        JSON.stringify({
          ...free,
          status: "completed",
          recap: { status: "pending", data: null, error: null },
        }),
      );
    return new Response(JSON.stringify([]));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("starts a free conversation with one click, without generating an exercise", async () => {
  const { container } = render(
    <GlossProvider>
      <App />
    </GlossProvider>,
  );
  const start = screen.getByRole("button", { name: "会話を始める" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  expect(container.querySelector(".sidebar")).toBeNull();
  expect(start.closest(".voice-empty")).not.toBeNull();
  expect(screen.getAllByRole("button", { name: "会話を始める" })).toHaveLength(1);
  expect(container.querySelector(".app")?.getAttribute("data-voice-state")).toBe("idle");
  expect((container.querySelector(".optional-practice") as HTMLDetailsElement).open).toBe(false);
  fireEvent.click(start);
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  expect(mocks.start.mock.calls[0][0]).toBe("free-test");
  const calls = vi.mocked(fetch).mock.calls;
  expect(
    calls.some(([url]) =>
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
        "/exercise",
      ),
    ),
  ).toBe(false);
  const create = calls.find(
    ([url, init]) =>
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith(
        "/lessons",
      ) && init?.method === "POST",
  );
  expect(JSON.parse(typeof create?.[1]?.body === "string" ? create?.[1]?.body : "").topic).toBe(
    "自由会話",
  );
});
it("automatically opens the dedicated recap page when free conversation ends", async () => {
  render(
    <GlossProvider>
      <App />
    </GlossProvider>,
  );
  const start = screen.getByRole("button", { name: "会話を始める" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  await act(async () => {
    const socket = mocks.sockets[0];
    socket.onmessage({
      data: JSON.stringify({
        type: "lesson",
        lesson: {
          ...free,
          status: "completed",
          rows: [
            {
              id: "u",
              role: "user",
              original: "Aku setuju.",
              corrected: null,
              revisionStale: false,
              startMs: 0,
              endMs: 1000,
            },
          ],
        },
      }),
    });
    socket.onmessage({
      data: JSON.stringify({
        type: "live",
        lessonId: free.id,
        event: { type: "session.closed", usage: { seconds: 5 } },
      }),
    });
  });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) =>
        (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
          "/evaluate",
        ),
      ),
  ).toBe(false);
  expect(screen.getByRole("heading", { name: "今日のレッスンノート" })).toBeTruthy();
  expect(location.hash).toBe("#/recap/free-test");
  expect(screen.queryByRole("log", { name: "会話の字幕" })).toBeNull();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) =>
        (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith(
          "/recap",
        ),
      ),
  ).toBe(true);
});

it("keeps reply hints mounted while reconnecting the same paused lesson", async () => {
  const paused: Lesson = {
    ...free,
    status: "paused",
    rows: [
      {
        id: "coach",
        role: "assistant",
        original: "Mau makan apa?",
        corrected: null,
        revisionStale: false,
        startMs: 0,
        endMs: 1000,
      },
    ],
  };
  localStorage.setItem("bahasa.voice", paused.id);
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (typeof url === "string" && url.endsWith("/lessons") && options?.method !== "POST")
      return new Response(JSON.stringify([paused]));
    if (typeof url === "string" && url.endsWith("/reply-hints"))
      return new Response(
        JSON.stringify({
          source: "Mau makan apa?",
          hints: [{ text: "Nasi goreng.", intent: "炒飯を選ぶ" }],
        }),
      );
    return originalFetch(url, options);
  });
  let finish!: () => void;
  mocks.start.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <GlossProvider prefetch={false}>
      <App />
    </GlossProvider>,
  );
  await waitFor(() => expect(screen.getByText("炒飯を選ぶ")).toBeTruthy(), { timeout: 2500 });
  const shown = screen.getByText("炒飯を選ぶ");
  fireEvent.click(screen.getByRole("button", { name: "マイクを再開" }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  expect(screen.getByText("炒飯を選ぶ")).toBe(shown);
  await act(async () => {
    finish();
  });
  expect(screen.getByText("炒飯を選ぶ")).toBe(shown);
});
it("prevents an older recap route from replacing the current active lesson", async () => {
  render(
    <GlossProvider prefetch={false}>
      <App />
    </GlossProvider>,
  );
  const start = screen.getByRole("button", { name: "会話を始める" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  await act(async () => {
    window.history.pushState(null, "", "#/recap/older-lesson");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(location.hash).toBe("#/voice");
  expect(screen.getByText("会話を終了してから、レッスンノートを開いてください。")).toBeTruthy();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => typeof url === "string" && url.includes("older-lesson")),
  ).toBe(false);
});

it("uses one stable microphone button to close the connection and reconnect with M", async () => {
  const pausedLesson: Lesson = { ...free, status: "paused", voiceSeconds: 30 };
  mocks.start.mockImplementation(async () => {
    mocks.active = {
      lessonId: free.id,
      owner: mocks.owner,
      sessionId: "live",
      status: "active",
      seconds: 30,
      startedAt: Date.now(),
    };
    const ws = mocks.sockets[0];
    ws.onmessage({
      data: JSON.stringify({ type: "lesson", lesson: { ...free, status: "active" } }),
    });
    ws.onmessage({
      data: JSON.stringify({ type: "live", lessonId: free.id, event: { type: "session.started" } }),
    });
  });
  mocks.pause.mockRejectedValueOnce(new Error("接続を停止できませんでした。"));
  mocks.pause.mockImplementationOnce(async () => {
    mocks.active = null;
    return pausedLesson;
  });
  render(
    <GlossProvider prefetch={false}>
      <App />
    </GlossProvider>,
  );
  const start = screen.getByRole("button", { name: "会話を始める" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  await waitFor(() => expect(screen.getByText("Rani に声が届いています")).toBeTruthy());
  const mic = screen.getByRole("button", { name: "マイクを止める" });
  const app = mic.closest(".app")!;
  expect(app.getAttribute("data-voice-state")).toBe("listening");
  expect(document.getElementById(mic.getAttribute("aria-describedby")!)?.textContent).toContain(
    "声が届いています",
  );
  await waitFor(() => expect((mic as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(mic);
  await waitFor(() => expect(screen.getByText(/接続を停止できませんでした。/)).toBeTruthy());
  expect(screen.queryByText("Rani に声が届いています")).toBeNull();
  expect(screen.getByText("停止を再試行")).toBeTruthy();
  expect(app.getAttribute("data-voice-state")).toBe("unconfirmed");
  fireEvent.click(mic);
  await waitFor(() => expect(screen.getByText("マイクは停止中です")).toBeTruthy());
  expect(app.getAttribute("data-voice-state")).toBe("paused");
  expect(screen.getByRole("button", { name: "マイクを再開" })).toBe(mic);
  expect(screen.queryByText("Rani に声が届いています")).toBeNull();
  expect(screen.queryByText("考える時間")).toBeNull();
  expect(screen.queryByText("その他")).toBeNull();
  expect(screen.queryByText("続きから話す")).toBeNull();
  fireEvent.keyDown(window, { key: "m" });
  await waitFor(() => expect(screen.getByText("Rani に声が届いています")).toBeTruthy());
  expect(screen.getByRole("button", { name: "マイクを止める" })).toBe(mic);
  expect(mocks.start).toHaveBeenCalledTimes(2);
  expect(mocks.start.mock.calls[1][0]).toBe(free.id);
  expect(mocks.pause).toHaveBeenCalledTimes(2);
});

it("removes the listening signal immediately while a microphone stop is still being confirmed", async () => {
  let finishPause!: () => void;
  mocks.start.mockImplementation(async () => {
    mocks.active = {
      lessonId: free.id,
      owner: mocks.owner,
      sessionId: "live",
      status: "active",
      seconds: 0,
      startedAt: Date.now(),
    };
    mocks.sockets[0].onmessage({
      data: JSON.stringify({ type: "live", lessonId: free.id, event: { type: "session.started" } }),
    });
  });
  mocks.pause.mockImplementation(
    () =>
      new Promise<Lesson>((resolve) => {
        finishPause = () => {
          mocks.active = null;
          resolve({ ...free, status: "paused" });
        };
      }),
  );
  const { container } = render(
    <GlossProvider prefetch={false}>
      <App />
    </GlossProvider>,
  );
  const start = screen.getByRole("button", { name: "会話を始める" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  await waitFor(() => expect(screen.getByText("Rani に声が届いています")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "マイクを止める" }));
  expect(container.querySelector(".app")?.getAttribute("data-voice-state")).toBe("stopping");
  expect(screen.queryByText("Rani に声が届いています")).toBeNull();
  expect(screen.queryByText("マイクは停止中です")).toBeNull();
  expect((screen.getByRole("button", { name: "停止中…" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.keyDown(window, { key: "m" });
  expect(mocks.pause).toHaveBeenCalledTimes(1);
  await act(async () => finishPause());
  await waitFor(() => expect(screen.getByText("マイクは停止中です")).toBeTruthy());
  expect(container.querySelector(".app")?.getAttribute("data-voice-state")).toBe("paused");
});
it("does not say this microphone is listening when another tab owns the call", async () => {
  mocks.active = {
    lessonId: free.id,
    owner: "another-tab",
    sessionId: "live",
    status: "active",
    seconds: 0,
    startedAt: Date.now(),
  };
  const { container } = render(
    <GlossProvider prefetch={false}>
      <App />
    </GlossProvider>,
  );
  await waitFor(() => expect(screen.getByText("別のタブで会話中です")).toBeTruthy());
  expect(container.querySelector(".app")?.getAttribute("data-voice-state")).toBe("external");
  expect(screen.queryByText("Rani に声が届いています")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "マイクを止める" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it.each(["zh-Hans", "en"] as Language[])(
  "starts a %s conversation with the selected language",
  async (language) => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (url === "/api/lessons" && options?.method === "POST") {
        const data = JSON.parse(options.body as string);
        return new Response(
          JSON.stringify({ ...free, language: data.language, direction: data.direction }),
        );
      }
      return original(url, options);
    });
    render(
      <GlossProvider>
        <App />
      </GlossProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "会話を始める" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "学習言語" }), {
      target: { value: language },
    });
    expect(
      screen.getByRole("heading", { name: `${LANGUAGE[language].coach} と話しましょう。` }),
    ).toBeTruthy();
    expect(Boolean(screen.queryByRole("checkbox", { name: "ピンインを表示" }))).toBe(
      language === "zh-Hans",
    );
    fireEvent.click(screen.getByRole("button", { name: "会話を始める" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    const creation = vi
      .mocked(fetch)
      .mock.calls.find(([url, options]) => url === "/api/lessons" && options?.method === "POST")!;
    expect(JSON.parse(creation[1]?.body as string)).toMatchObject({
      language,
      direction: directionFor(language),
    });
    expect(localStorage.getItem("bahasa.language")).toBe(language);
  },
);

it("restores separate writing drafts and filters history when switching languages", async () => {
  const english: Lesson = {
    ...free,
    id: "english-draft",
    language: "en",
    kind: "writing",
    direction: "ja-en",
    title: "英語の依頼",
    exercise: {
      title: "英語の依頼",
      prompt: "依頼しましょう。",
      context: "",
      focus: [],
      annotations: [],
    },
    draft: "Could you help?",
  };
  const chinese: Lesson = {
    ...english,
    id: "chinese-draft",
    language: "zh-Hans",
    direction: "ja-zh",
    title: "中国語の依頼",
    draft: "请帮我。",
  };
  localStorage.setItem("bahasa.language", "en");
  localStorage.setItem("bahasa.writing.en", english.id);
  localStorage.setItem("bahasa.writing.zh-Hans", chinese.id);
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) =>
    url === "/api/lessons" && options?.method !== "POST"
      ? new Response(JSON.stringify([english, chinese]))
      : original(url, options),
  );
  render(
    <GlossProvider prefetch={false}>
      <App />
    </GlossProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "作文" }));
  await waitFor(() => expect(screen.getByDisplayValue("Could you help?")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("あなたの回答"), {
    target: { value: "Could you help me tomorrow?" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "学習言語" }), {
    target: { value: "zh-Hans" },
  });
  expect(screen.getByDisplayValue("请帮我。")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "学習言語" }), { target: { value: "en" } });
  expect(screen.getByDisplayValue("Could you help me tomorrow?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "履歴" }));
  await waitFor(() => expect(screen.getByText("英語の依頼")).toBeTruthy());
  expect(screen.queryByText("中国語の依頼")).toBeNull();
});

it("disables language switching while a voice connection is active", async () => {
  mocks.active = {
    lessonId: free.id,
    sessionId: "s",
    owner: "another-tab",
    status: "active",
    seconds: 15,
    startedAt: Date.now(),
  };
  render(
    <GlossProvider>
      <App />
    </GlossProvider>,
  );
  await waitFor(() =>
    expect((screen.getByRole("combobox", { name: "学習言語" }) as HTMLSelectElement).disabled).toBe(
      true,
    ),
  );
});
