// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { VoiceClient } from "./voice";
afterEach(() => vi.restoreAllMocks());
function setup() {
  const pause = vi.fn(),
    play = vi.fn();
  const audio = { pause, play, srcObject: {} } as unknown as HTMLAudioElement;
  const track = { enabled: true, stop: vi.fn() };
  const client = new VoiceClient("owner", audio);
  client.mic = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { client, track, pause, play };
}
it("silences Rani and microphone input immediately, without waiting for network closure", async () => {
  let finish!: (r: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { client, track, pause } = setup();
  const closing = client.pause();
  expect(pause).toHaveBeenCalledOnce();
  expect(track.enabled).toBe(false);
  expect(track.stop).not.toHaveBeenCalled();
  finish(new Response(JSON.stringify({ status: "paused" })));
  await closing;
  expect(track.stop).toHaveBeenCalledOnce();
});
it("keeps local audio silent when closing fails so the same control can retry", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const { client, track, pause, play } = setup();
  await expect(client.pause()).rejects.toThrow("offline");
  expect(pause).toHaveBeenCalledOnce();
  expect(track.enabled).toBe(false);
  expect(play).not.toHaveBeenCalled();
});
