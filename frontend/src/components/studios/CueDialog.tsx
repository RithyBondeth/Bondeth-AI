"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, Input, Textarea } from "@/components/ui";
import { parseCueTime, splitCue, splitCueText } from "@/lib/cueEditing";
import { subtitleTimestamp } from "@/lib/subtitles";
import type { TranscriptSegment } from "@/lib/types";
import { useT } from "@/lib/useLocale";

export type CueAction = { kind: "timing" | "split"; index: number; caret?: number; playhead: number | null };

export function CueDialog({ action, segments, language, canUsePlayback, position, onCommit, onClose }: {
  action: CueAction; segments: TranscriptSegment[]; canUsePlayback: boolean;
  language: string;
  position: () => number | null; onCommit: (segments: TranscriptSegment[]) => string | null; onClose: () => void;
}) {
  const t = useT();
  const cue = segments[action.index];
  const splitting = action.kind === "split";
  const middle = Math.floor((Math.round(cue.start * 1000) + Math.round(cue.end * 1000)) / 2) / 1000;
  const suggested = action.playhead != null && action.playhead > cue.start && action.playhead < cue.end ? action.playhead : middle;
  const [start, setStart] = useState(() => subtitleTimestamp(splitting ? suggested : cue.start));
  const [end, setEnd] = useState(() => subtitleTimestamp(cue.end));
  const [parts, setParts] = useState(() => splitCueText(cue.text, action.caret));
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = form.current?.closest<HTMLElement>('[role="dialog"]');
    form.current?.querySelector<HTMLInputElement>("input")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener("keydown", trap);
    return () => { dialog?.removeEventListener("keydown", trap); previous?.focus(); };
  }, []);

  const setFromPlayback = (field: "start" | "end") => {
    const time = position();
    if (time === null) { setError("Play source audio before using its position."); return; }
    (field === "start" ? setStart : setEnd)(subtitleTimestamp(time)); setError(null);
  };

  const apply = () => {
    const from = parseCueTime(start), to = parseCueTime(end);
    if (from === null || !splitting && to === null) { setError("Enter a time as HH:MM:SS.mmm or seconds, with up to three decimal places."); return; }
    try {
      const next = splitting ? splitCue(segments, action.index, from, parts[0], parts[1])
        : segments.map((segment, index) => index === action.index ? { ...segment, start: from, end: to! } : segment);
      const problem = onCommit(next);
      if (problem) setError(problem); else onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't edit this segment."); }
  };

  return <Dialog open onClose={onClose} title={t(splitting ? "Split segment {number}" : "Edit timing for segment {number}", { number: action.index + 1 })}>
    <form ref={form} className="space-y-4" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <p className="text-sm leading-relaxed text-ink-soft">{t(splitting
        ? "Review the split time and both text parts. The suggested time uses playback when it is inside the segment, otherwise the midpoint."
        : "Adjust when this subtitle appears and disappears. Apply to autosave the new timing.")}</p>
      <p className="text-xs text-ink-soft">{t("Use HH:MM:SS.mmm or seconds, for example 00:00:02.500 or 2.5.")}</p>
      <label className="block space-y-2 text-sm">
        <span>{t(splitting ? "Split time" : "Start time")}</span>
        <Input value={start} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
          onChange={(event) => { setStart(event.target.value); setError(null); }} />
      </label>
      {canUsePlayback && <Button type="button" variant="secondary" size="sm" onClick={() => setFromPlayback("start")}>{t(splitting ? "Use playback position" : "Use playback for start")}</Button>}
      {!splitting && <>
        <label className="block space-y-2 text-sm"><span>{t("End time")}</span>
          <Input value={end} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
            onChange={(event) => { setEnd(event.target.value); setError(null); }} />
        </label>
        {canUsePlayback && <Button type="button" variant="secondary" size="sm" onClick={() => setFromPlayback("end")}>{t("Use playback for end")}</Button>}
      </>}
      {splitting && parts.map((part, index) => <label key={index} className="block space-y-2 text-sm">
        <span>{t(index === 0 ? "First part" : "Second part")}</span>
        <Textarea lang={language} className={language === "km" ? "khmer" : undefined} rows={3} maxLength={10000} value={part} onChange={(event) => {
          setParts(index === 0 ? [event.target.value, parts[1]] : [parts[0], event.target.value]); setError(null);
        }} />
      </label>)}
      {error && <p id={errorId} role="alert" className="text-sm text-rose">{t(error)}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>{t("Cancel")}</Button>
        <Button type="submit">{t(splitting ? "Apply split" : "Apply timing")}</Button>
      </div>
    </form>
  </Dialog>;
}
