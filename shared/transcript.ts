import type { TranscriptRow } from "./types.ts";

export interface TranscriptBlock {
  id: string;
  role: TranscriptRow["role"];
  text: string;
  rows: TranscriptRow[];
}
export function sentenceEnded(text: string) {
  return /[.!?。！？][\s"'”’）)]*$/.test(text) && !/(?:\.{2,}|…)[\s"'”’）)]*$/.test(text);
}

// Persistence rows are transport chunks, not utterances. Only the reading projection
// joins them: never alter raw fragments, correction anchors, or speech ordering.
export function transcriptBlocks(rows: TranscriptRow[]): TranscriptBlock[] {
  const result: TranscriptBlock[] = [];
  const last = new Map<TranscriptRow["role"], TranscriptBlock>();
  for (const row of rows) {
    const text = row.corrected ?? row.original;
    const previous = last.get(row.role);
    const other = result.at(-1);
    const contiguous = other === previous;
    const acknowledgment =
      other &&
      /^(iya|ya|oke|okay|ok|oh|hmm|mhm|うん|はい|嗯)[.!?。！？\s]*$/iu.test(other.text.trim());
    const overlap = other && row.startMs <= Math.max(...other.rows.map((r) => r.endMs));
    const unfinished = previous && !sentenceEnded(previous.text) && (acknowledgment || overlap);
    const longParagraph = previous && previous.text.length > 480 && sentenceEnded(previous.text);
    // A short acknowledgment can overlap an unfinished sentence. A new response
    // after a completed sentence gets a new paragraph, independently of silence.
    if (previous && (contiguous || unfinished) && !longParagraph) {
      previous.rows.push(row);
      previous.text +=
        sentenceEnded(previous.text) && !/\s$/.test(previous.text) && !/^\s/.test(text)
          ? " " + text
          : text;
    } else {
      const block = { id: row.id, role: row.role, text, rows: [row] };
      result.push(block);
      last.set(row.role, block);
    }
  }
  return result;
}

export function normalizeEvidence(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function isGrounded(quote: string, learnerText: string) {
  const normalized = normalizeEvidence(quote);
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    (/^[A-Za-z0-9]/.test(normalized) ? "(?<![A-Za-z0-9])" : "") +
      escaped +
      (/[A-Za-z0-9]$/.test(normalized) ? "(?![A-Za-z0-9])" : ""),
    "u",
  ).test(normalizeEvidence(learnerText));
}
export function learnerText(rows: TranscriptRow[]) {
  return transcriptBlocks(rows.filter((r) => r.role === "user" && !r.revisionStale))
    .map((b) => b.text)
    .join("\n");
}
