import { api } from "./api";
export class VoiceClient {
  peer: RTCPeerConnection | null = null;
  mic: MediaStream | null = null;
  channel: RTCDataChannel | null = null;
  audio: HTMLAudioElement;
  owner: string;
  private cancelled = false;
  constructor(owner: string, audio: HTMLAudioElement) {
    this.owner = owner;
    this.audio = audio;
  }
  async start(
    lessonId: string,
    onEvent: (event: Record<string, unknown>) => void,
    onFailure: (message: string) => void,
  ) {
    this.cancelled = false;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.cancelled) {
        this.cleanup();
        return;
      }
      const peer = new RTCPeerConnection();
      this.peer = peer;
      for (const track of this.mic.getAudioTracks()) peer.addTrack(track, this.mic);
      peer.addEventListener("track", (event) => {
        this.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void this.audio
          .play()
          .catch(() =>
            onFailure(
              "音声の再生が止められました。「その他」の「音声の再生を再開」を押してください。",
            ),
          );
      });
      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.addEventListener("message", (event) => {
        try {
          onEvent(JSON.parse(event.data));
        } catch {}
      });
      peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected"].includes(peer.connectionState) && !this.cancelled) {
          onFailure("音声接続が切れました。会話を終了します。");
          void api("/live/stop", { owner: this.owner }).finally(() => this.cleanup());
        }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            peer.removeEventListener("icegatheringstatechange", changed);
            reject(new Error("マイクの接続準備がタイムアウトしました。"));
          }, 10_000);
          const changed = () => {
            if (peer.iceGatheringState === "complete") {
              clearTimeout(timer);
              peer.removeEventListener("icegatheringstatechange", changed);
              resolve();
            }
          };
          peer.addEventListener("icegatheringstatechange", changed);
          changed();
        });
      if (this.cancelled) return;
      const result = await api<{ session: { id: string }; transport: { sdp: string } }>(
        "/live/start",
        { owner: this.owner, lessonId, sdp: peer.localDescription?.sdp },
      );
      if (this.cancelled) {
        await api("/live/stop", { owner: this.owner });
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
    } catch (e) {
      await api("/live/stop", { owner: this.owner }).catch(() => {});
      this.cleanup();
      throw e;
    }
  }
  mute(muted: boolean) {
    for (const track of this.mic?.getAudioTracks() || []) track.enabled = !muted;
  }
  async stop() {
    this.cancelled = true;
    try {
      await api("/live/stop", { owner: this.owner });
    } finally {
      this.cleanup();
    }
  }
  cleanup() {
    this.cancelled = true;
    this.channel?.close();
    this.peer?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.channel = null;
    this.peer = null;
    this.mic = null;
    this.audio.pause();
    this.audio.srcObject = null;
  }
}
