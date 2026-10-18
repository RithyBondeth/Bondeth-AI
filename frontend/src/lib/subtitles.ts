import type { TranscriptDraft, TranscriptSegment } from "@/lib/types";

export function transcriptDraft(text: string, segments: TranscriptSegment[] | null): TranscriptDraft {
  return { text: segments?.length ? segments.map((segment) => segment.text.trim()).filter(Boolean).join(" ") : text,
    segments: segments?.length ? segments : null };
}

export function subtitleTimestamp(seconds: number, separator = "."): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}

export function subtitleText(segments: TranscriptSegment[], format: "srt" | "vtt"): string {
  const blocks: string[] = [];
  for (const segment of segments) {
    const text = segment.text.replace(/\r\n?/g, "\n").replace(/\0/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (!text || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0
      || Math.round(segment.end * 1000) <= Math.round(segment.start * 1000)) continue;
    const separator = format === "srt" ? "," : ".";
    blocks.push(`${blocks.length + 1}\n${subtitleTimestamp(segment.start, separator)} --> ${subtitleTimestamp(segment.end, separator)}\n${text}`);
  }
  if (!blocks.length) throw new Error("No timed subtitle text is available.");
  return (format === "vtt" ? "WEBVTT\n\n" : "") + blocks.join("\n\n") + "\n";
}

export function downloadTranscript(text: string, format: "txt" | "srt" | "vtt") {
  const type = { txt: "text/plain", srt: "application/x-subrip", vtt: "text/vtt" }[format];
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  Object.assign(document.createElement("a"), { href: url, download: `transcript.${format}` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
