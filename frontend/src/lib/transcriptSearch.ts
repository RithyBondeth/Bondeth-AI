import { transcriptDraft } from "./subtitles";
import type { TranscriptDraft } from "./types";

export type TranscriptMatch = { segment: number; start: number; end: number };
export type IndexedText = { text: string; offsets: Map<number, number> | null };
export const MAX_TRANSCRIPT_MATCHES = 10000;
const graphemes = new Intl.Segmenter("km", { granularity: "grapheme" });
const fold = (text: string, matchCase: boolean) => matchCase ? text.normalize("NFC") : text.normalize("NFC").toLowerCase();

/** Map normalized search offsets back to complete original graphemes, never to partial marks. */
export function indexTranscript(draft: TranscriptDraft, matchCase: boolean): IndexedText[] {
  return (draft.segments?.map((segment) => segment.text) ?? [draft.text]).map((text) => {
    // ASCII has identity offsets. Avoid a per-character map for common English transcripts.
    if (/^[\x20-\x7e\n\t]*$/.test(text)) return { text: fold(text, matchCase), offsets: null };
    const offsets = new Map<number, number>([[0, 0]]), pieces: string[] = [];
    let length = 0;
    for (const part of graphemes.segment(text)) {
      const piece = fold(part.segment, matchCase);
      pieces.push(piece); length += piece.length;
      offsets.set(length, part.index + part.segment.length);
    }
    return { text: pieces.join(""), offsets };
  });
}

export function findTranscriptMatches(index: IndexedText[], query: string, matchCase: boolean) {
  const needle = fold(query, matchCase), matches: TranscriptMatch[] = [];
  if (!needle) return { matches, overflow: false };
  for (let segment = 0; segment < index.length; segment++) {
    const source = index[segment];
    let from = 0;
    while (from <= source.text.length - needle.length) {
      const start = source.text.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      const originalStart = source.offsets ? source.offsets.get(start) : start;
      const originalEnd = source.offsets ? source.offsets.get(end) : end;
      if (originalStart !== undefined && originalEnd !== undefined) {
        matches.push({ segment, start: originalStart, end: originalEnd });
        if (matches.length > MAX_TRANSCRIPT_MATCHES) return { matches: [], overflow: true };
        from = end; // Non-overlapping literal matches; replacement never re-searches inserted text.
      } else from = start + 1;
    }
  }
  return { matches, overflow: false };
}

/** Check the resulting sizes before allocating expanded strings or committing any cue. */
export function replacementError(draft: TranscriptDraft, matches: TranscriptMatch[], replacement: string): string | null {
  if (replacement.includes("\0")) return "Replacement cannot contain null characters.";
  const lengths = draft.segments?.map((segment) => segment.text.length) ?? [draft.text.length];
  for (const match of matches) lengths[match.segment] += replacement.length - (match.end - match.start);
  if (draft.segments && lengths.some((length) => length > 10000)) return "Replacement would exceed 10,000 characters in a segment.";
  if (lengths.reduce((total, length) => total + length, 0) > 500000) return "Replacement would exceed 500,000 characters in this transcript.";
  return null;
}

export function replaceTranscriptMatches(draft: TranscriptDraft, matches: TranscriptMatch[], replacement: string): TranscriptDraft {
  const problem = replacementError(draft, matches, replacement);
  if (problem) throw new Error(problem);
  const bySegment = new Map<number, TranscriptMatch[]>();
  for (const match of matches) {
    const group = bySegment.get(match.segment) ?? [];
    group.push(match); bySegment.set(match.segment, group);
  }
  const replace = (text: string, segment: number) => {
    const group = bySegment.get(segment);
    if (!group) return text;
    const pieces: string[] = [];
    let from = 0;
    for (const match of group) { pieces.push(text.slice(from, match.start), replacement); from = match.end; }
    pieces.push(text.slice(from));
    return pieces.join("");
  };
  return draft.segments ? transcriptDraft("", draft.segments.map((segment, i) => bySegment.has(i)
    ? { ...segment, text: replace(segment.text, i) } : segment)) : { text: replace(draft.text, 0), segments: null };
}
