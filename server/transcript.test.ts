import { describe, expect, it } from "vite-plus/test";
import { transcriptBlocks, isGrounded } from "../shared/transcript.ts";
import type { TranscriptRow } from "../shared/types.ts";
function row(
  id: string,
  original: string,
  startMs: number,
  endMs: number,
  role: TranscriptRow["role"] = "assistant",
): TranscriptRow {
  return { id, original, startMs, endMs, role, corrected: null, revisionStale: false };
}
describe("readable live captions", () => {
  it("joins partial words and sentences even across pauses longer than the old cutoff", () => {
    const rows = [
      row("a", "Aku me", 0, 100),
      row("b", "ngerti ", 3000, 3200),
      row("c", "sekarang.", 6200, 6500),
    ];
    expect(transcriptBlocks(rows).map((b) => b.text)).toEqual(["Aku mengerti sekarang."]);
    expect(rows.map((r) => r.original)).toEqual(["Aku me", "ngerti ", "sekarang."]);
  });
  it("keeps an unfinished sentence together across overlapping acknowledgments", () => {
    const rows = [
      row("a", "Kalau kamu ", 0, 1000),
      row("b", "うん", 700, 1200, "user"),
      row("c", "mau, kita bisa mulai.", 1300, 2400),
    ];
    expect(transcriptBlocks(rows).map((b) => b.text)).toEqual([
      "Kalau kamu mau, kita bisa mulai.",
      "うん",
    ]);
  });
  it("keeps real completed speaker exchanges separate", () => {
    const rows = [
      row("a", "Kapan?", 0, 1000),
      row("b", "Besok.", 1100, 1600, "user"),
      row("c", "Jam berapa?", 2000, 2900),
    ];
    expect(transcriptBlocks(rows)).toHaveLength(3);
  });
  it("does not join unrelated incomplete utterances across a substantive response", () => {
    const rows = [
      row("a", "Saya kurang", 0, 1000, "user"),
      row("b", "Mau saya ulangi?", 1500, 2500),
      row("c", "Ya, tolong.", 3000, 4000, "user"),
    ];
    expect(transcriptBlocks(rows)).toHaveLength(3);
  });
  it("keeps correction anchors and mixed languages intact", () => {
    const a = row("a", "Aku は deadline ", 0, 100),
      b = row("b", "是明天？", 2000, 2300);
    b.corrected = "是明天？";
    const block = transcriptBlocks([a, b])[0];
    expect(block.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(block.text).toBe("Aku は deadline 是明天？");
  });
  it("requires an actual quote, not a substring inside another word", () => {
    expect(isGrounded("dia", "hadiah")).toBe(false);
    expect(isGrounded("Aku setuju.", "aku setuju, tapi besok.")).toBe(true);
    expect(isGrounded("明日", "明日に変更できますか")).toBe(true);
  });
});
