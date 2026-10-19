"use client";

import { useImperativeHandle, useMemo, useState, type Ref } from "react";
import { Button, cx } from "@/components/ui";
import { captionText, subtitleIssues, suggestedTiming, type QualityKind, type SubtitleIssue } from "@/lib/subtitleQuality";
import { subtitleTimestamp } from "@/lib/subtitles";
import type { TranscriptSegment } from "@/lib/types";
import { useT } from "@/lib/useLocale";

const labels: Record<QualityKind, string> = {
  length: "Caption is too long", short: "Display time is short", long: "Display time is long",
  fast: "Reading speed is high", overlap: "Captions overlap", empty: "Empty caption is omitted from exports",
};

export type SubtitlePreviewHandle = { setTime: (time: number) => void };

export function SubtitleQuality({ ref, segments, duration, language, resolving, onPreview, onNavigate, onFix }: {
  ref: Ref<SubtitlePreviewHandle>; segments: TranscriptSegment[]; duration: number | null; language: string; resolving: boolean;
  onPreview: (time: number) => void; onNavigate: (index: number) => void;
  onFix: (issue: SubtitleIssue, end: number | null) => void;
}) {
  const t = useT();
  const [time, setTime] = useState(0);
  useImperativeHandle(ref, () => ({ setTime }), []);
  const issues = useMemo(() => subtitleIssues(segments), [segments]);
  const [page, setPage] = useState(0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(issues.length / 50) - 1));
  const maximum = Math.max(duration ?? 0, ...segments.map(cue => cue.end), 0.001);
  const position = Math.max(0, Math.min(time, maximum));
  const active = time < 0 ? [] : segments.filter(cue => cue.start <= position && position < cue.end && captionText(cue.text));
  return <section aria-label={t("Subtitle quality and preview")} className="space-y-4 border-b border-line p-5">
    <h3 className="text-sm font-medium">{t("Live caption preview")}</h3>
    <div aria-label={t("Caption preview")} data-caption-preview lang={language}
      className={cx("flex min-h-36 max-h-72 flex-col overflow-y-auto rounded-xl bg-neutral-950 p-4 text-center text-lg leading-relaxed text-white", language === "km" && "khmer")}>
      <div className="mt-auto space-y-2">{active.length ? active.map((cue, index) => <p key={index} className="whitespace-pre-wrap break-words">{captionText(cue.text)}</p>)
        : <p className="text-sm text-neutral-300">{t("No caption at this time")}</p>}</div>
    </div>
    <label className="flex flex-wrap items-center gap-3 text-xs text-ink-soft">
      <span>{t("Preview position")}</span>
      <input aria-label={t("Preview position")} type="range" min={0} max={maximum} step={0.001} value={position}
        className="min-w-0 flex-1" onChange={event => onPreview(Number(event.target.value))} />
      <span className="tabular-nums">{subtitleTimestamp(position)}</span>
    </label>
    <p className="text-xs leading-relaxed text-ink-soft">{t("Preview follows source audio. Scrub or select an issue to preview silently, even without a recording. Captions wrap to fit this panel; exported line breaks stay unchanged.")}</p>
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t("Subtitle quality")} <span className="text-ink-soft">({issues.length})</span></h3>
      <p className="text-xs leading-relaxed text-ink-soft">{t("Advisory defaults: 42 visible units per line, 2 lines, 17 units/second, and 1–7 seconds. Khmer marks and joined emoji stay together. These are editing hints, not language-specific reading guarantees. Exports are always available.")}</p>
      <p className="text-xs text-ink-soft">{t("Review suggestions before applying. Each applied fix takes one Undo. Timing changes may need listening checks.")}</p>
    </div>
    {!issues.length ? <p className="text-sm text-teal">{t("No subtitle issues found")}</p> : <>
      <ol aria-label={t("Subtitle issues")} className="max-h-72 space-y-2 overflow-y-auto">
        {issues.slice(currentPage * 50, (currentPage + 1) * 50).map(issue => {
          const end = suggestedTiming(segments, issue, duration);
          const split = issue.kind === "length" && segments.length < 20000
            && Math.round(segments[issue.segment].end * 1000) - Math.round(segments[issue.segment].start * 1000) >= 2;
          return <li key={`${issue.segment}:${issue.kind}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3">
            <button type="button" className="min-w-0 flex-1 text-left text-sm text-accent underline underline-offset-4"
              onClick={() => onNavigate(issue.segment)}>{t("Segment {number}: {issue}", { number: issue.segment + 1, issue: t(labels[issue.kind]) })}</button>
            {issue.kind === "fast" && <span className="text-xs text-ink-soft">{t("{value} units/second", { value: issue.value.toFixed(1) })}</span>}
            {(split || end !== null) && <Button variant="secondary" size="sm" disabled={resolving}
              aria-label={t("{action} for segment {number}", { action: t(split ? "Review split" : "Review timing suggestion"), number: issue.segment + 1 })}
              onClick={() => onFix(issue, end)}>{t(split ? "Review split" : "Review timing suggestion")}</Button>}
          </li>;
        })}
      </ol>
      {issues.length > 50 && <div className="flex flex-wrap items-center gap-3 text-xs">
        <Button variant="secondary" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("Previous issues")}</Button>
        <span>{t("Page {current} of {total}", { current: currentPage + 1, total: Math.ceil(issues.length / 50) })}</span>
        <Button variant="secondary" size="sm" disabled={(currentPage + 1) * 50 >= issues.length} onClick={() => setPage(currentPage + 1)}>{t("Next issues")}</Button>
      </div>}
    </>}
  </section>;
}
