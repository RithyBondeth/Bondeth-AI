import type { TranscriptSegment } from "./types";

// Advisory editing defaults, not language-specific readability guarantees.
export const SUBTITLE_LIMITS = { line: 42, lines: 2, speed: 17, minimum: 1, maximum: 7 };
export type QualityKind = "length" | "short" | "long" | "fast" | "overlap" | "empty";
export type SubtitleIssue = { segment: number; kind: QualityKind; value: number };
const graphemes = new Intl.Segmenter("km", { granularity: "grapheme" });

/** Count visible graphemes, never UTF-16 units or individual Khmer combining marks. */
export function visibleUnits(text: string): number {
  if (/^[\x20-\x7e\n\r\t]*$/.test(text)) return text.replace(/\s/g, "").length;
  let count = 0;
  for (const part of graphemes.segment(text.normalize("NFC"))) {
    if (/[^\s\p{Cf}\p{M}]/u.test(part.segment)) count++;
  }
  return count;
}

// Same blank-line normalization as subtitle export; keep the authored line breaks.
export function captionText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\0/g, "").split("\n").map(line => line.trim()).filter(Boolean).join("\n");
}

export function subtitleIssues(segments: TranscriptSegment[]): SubtitleIssue[] {
  const issues: SubtitleIssue[] = [];
  let previousEnd = -1;
  segments.forEach((cue, segment) => {
    const text = captionText(cue.text), lines = text.split("\n"), units = visibleUnits(text);
    const duration = (Math.round(cue.end * 1000) - Math.round(cue.start * 1000)) / 1000;
    const add = (kind: QualityKind, value: number) => issues.push({ segment, kind, value });
    if (!text) add("empty", 0);
    else {
      const longest = Math.max(...lines.map(visibleUnits));
      if (longest > SUBTITLE_LIMITS.line || lines.length > SUBTITLE_LIMITS.lines) add("length", longest);
      if (duration < SUBTITLE_LIMITS.minimum) add("short", duration);
      if (duration > SUBTITLE_LIMITS.maximum) add("long", duration);
      if (units / duration > SUBTITLE_LIMITS.speed) add("fast", units / duration);
    }
    // Running maximum catches nested/non-adjacent overlaps as well as neighboring cues.
    if (cue.start < previousEnd || segment + 1 < segments.length && cue.end > segments[segment + 1].start) add("overlap", 0);
    previousEnd = Math.max(previousEnd, cue.end);
  });
  return issues;
}

/** Only suggest timing that fits the next cue and known recording duration. Never shift neighbors. */
export function suggestedTiming(segments: TranscriptSegment[], issue: SubtitleIssue, duration: number | null): number | null {
  const cue = segments[issue.segment];
  if (!cue || !["short", "fast", "long", "overlap"].includes(issue.kind)) return null;
  const ceiling = Math.min(segments[issue.segment + 1]?.start ?? Infinity, duration ?? Infinity, 3600000);
  const needed = Math.max(SUBTITLE_LIMITS.minimum, visibleUnits(captionText(cue.text)) / SUBTITLE_LIMITS.speed);
  let end: number;
  if (issue.kind === "overlap") end = Math.min(cue.end, ceiling);
  else if (issue.kind === "long") {
    if (needed > SUBTITLE_LIMITS.maximum) return null;
    end = Math.min(cue.start + SUBTITLE_LIMITS.maximum, ceiling);
  }
  else {
    if (needed > SUBTITLE_LIMITS.maximum) return null;
    end = cue.start + needed;
    if (end > ceiling || end <= cue.end) return null;
  }
  end = Math.ceil(end * 1000) / 1000;
  if (end > ceiling || end <= cue.start || end === cue.end) return null;
  return end;
}
