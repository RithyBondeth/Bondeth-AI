import type { TranscriptSegment } from "./types";

/** Millisecond timestamps, with seconds accepted for quick keyboard entry. */
export function parseCueTime(value: string): number | null {
  const input = value.trim().replace(",", ".");
  let time: number;
  if (/^\d+(?:\.\d{1,3})?$/.test(input)) time = Number(input);
  else {
    const match = /^(?:(\d{1,4}):)?([0-5]?\d):([0-5]?\d)(?:\.(\d{1,3}))?$/.exec(input);
    if (!match) return null;
    time = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
      + Number((match[4] ?? "").padEnd(3, "0")) / 1000;
  }
  return Number.isFinite(time) && time <= 3600000 ? Math.round(time * 1000) / 1000 : null;
}

export function cueError(segments: TranscriptSegment[], duration: number | null): string | null {
  if (!segments.length || segments.length > 20000) return "A transcript can contain up to 20,000 segments.";
  if (segments.some((s) => !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0
    || s.end > 3600000 || Math.round(s.end * 1000) <= Math.round(s.start * 1000)))
    return "End time must be at least one millisecond after start time.";
  if (duration != null && segments.some((s) => s.end > duration + 0.02)) return "Subtitle timing exceeds the audio duration";
  if (segments.some((s, i) => i > 0 && s.start < segments[i - 1].start)) return "Segments must stay ordered by start time.";
  if (segments.some((s) => s.text.includes("\0"))) return "Transcript cannot contain null characters";
  if (segments.some((s) => s.text.length > 10000)) return "A segment can contain up to 10,000 characters. Shorten the text before merging.";
  if (segments.reduce((size, s) => size + s.text.length, 0) > 500000) return "A transcript can contain up to 500,000 characters.";
  return null;
}

/** Honor the caret without breaking Khmer combining marks or emoji sequences. */
export function splitCueText(text: string, caret?: number): [string, string] {
  const boundaries = [0, ...Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (part) => part.index + part.segment.length)];
  const requested = caret ?? text.length / 2;
  const offset = boundaries.reduce((best, boundary) => Math.abs(boundary - requested) < Math.abs(best - requested) ? boundary : best, 0);
  return [text.slice(0, offset), text.slice(offset)];
}

export function splitCue(segments: TranscriptSegment[], index: number, time: number, first: string, second: string): TranscriptSegment[] {
  const cue = segments[index];
  if (Math.round(time * 1000) <= Math.round(cue.start * 1000) || Math.round(time * 1000) >= Math.round(cue.end * 1000))
    throw new Error("Split time must be inside the segment, at least one millisecond from each end.");
  return [...segments.slice(0, index), { ...cue, end: time, text: first }, { ...cue, start: time, text: second },
    ...segments.slice(index + 1)].sort((a, b) => a.start - b.start);
}

export function mergeCue(segments: TranscriptSegment[], index: number): TranscriptSegment[] {
  const first = segments[index], second = segments[index + 1];
  return [...segments.slice(0, index), { start: first.start, end: Math.max(first.end, second.end),
    text: [first.text.trim(), second.text.trim()].filter(Boolean).join(" ") }, ...segments.slice(index + 2)];
}

export function activeCue(segments: TranscriptSegment[] | null, time: number): number {
  let index = -1;
  if (time >= 0) segments?.forEach((segment, i) => { if (segment.start <= time && time < segment.end) index = i; });
  return index;
}
