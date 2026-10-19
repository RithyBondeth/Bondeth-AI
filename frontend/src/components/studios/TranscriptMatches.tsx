import type { TranscriptMatch } from "@/lib/transcriptSearch";

export function TranscriptMatches({ text, matches, current }: {
  text: string; matches?: Array<TranscriptMatch & { ordinal: number }>; current: number;
}) {
  if (!matches?.length) return <>{text}</>;
  return <>{matches.map((match, index) => {
    const prefix = text.slice(index ? matches[index - 1].end : 0, match.start);
    const selected = match.ordinal === current;
    return <span key={match.ordinal}>{prefix}<mark data-search-match={match.ordinal} data-search-current={selected}
      className={selected ? "scroll-mb-6 rounded-sm bg-accent text-accent-ink ring-2 ring-accent" : "scroll-mb-6 rounded-sm bg-accent-soft text-ink"}>
      {text.slice(match.start, match.end)}</mark></span>;
  })}{text.slice(matches[matches.length - 1].end)}</>;
}
