"use client";

import { useT } from "@/lib/useLocale";

import { Check, Copy, Download } from "lucide-react";
import { useRef, useState } from "react";

import { TranscriptAudio, type TranscriptPlayback } from "@/components/audio/TranscriptAudio";
import { CueDialog, type CueAction } from "@/components/studios/CueDialog";
import { Badge, Button, IconButton, Panel, Segmented, Textarea, cx, useToast } from "@/components/ui";
import { LANG_LABEL, formatSeconds } from "@/lib/format";
import { activeCue, cueError, mergeCue } from "@/lib/cueEditing";
import { downloadTranscript, subtitleText, subtitleTimestamp, transcriptDraft } from "@/lib/subtitles";
import type { TranscriptDocument, TranscriptDraft, TranscriptSegment } from "@/lib/types";
import { useTranscriptAutosave } from "@/lib/useTranscriptAutosave";

type View = "text" | "words" | "timeline" | "edit";

export function TranscriptEditor({ document, ownerId }: { document: TranscriptDocument; ownerId: string | null }) {
  const t = useT();
  const playback = useRef<TranscriptPlayback>(null);
  const [activeSegment, setActiveSegment] = useState(-1);
  const [sourceRemoved, setSourceRemoved] = useState(false);
  const [action, setAction] = useState<CueAction | null>(null);
  const caret = useRef<Record<number, number>>({});
  const canSeek = !sourceRemoved && !!document.id && !!ownerId && ["available", "pending"].includes(document.source_audio_status ?? "");
  const toast = useToast();
  const editor = useTranscriptAutosave(document, ownerId);
  const [view, setView] = useState<View>("text");
  const [copied, setCopied] = useState(false);
  const { draft, saved, dirty, status, error, resolving } = editor;
  const isKhmer = document.language_code === "km";
  const words = !dirty && draft.text === saved.transcribed_text ? saved.segmented_text : null;
  const text = view === "words" && words ? words : draft.text;
  const hasSubtitles = !!draft.segments?.some((segment) => segment.text.trim() && segment.end > segment.start);
  const views: { value: View; label: string }[] = [
    { value: "text", label: "Text" }, { value: "edit", label: "Edit" },
    ...(isKhmer && words ? [{ value: "words" as const, label: "Words" }] : []),
    ...(draft.segments?.length ? [{ value: "timeline" as const, label: "Timeline" }] : []),
  ];
  const saveLabel = !document.id ? "Session only" : status === "conflict" ? "Changed elsewhere"
    : status === "error" ? "Save failed" : status === "saving" ? "Saving…" : dirty ? "Unsaved changes" : "Saved";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true); toast("Copied to clipboard", "success");
      setTimeout(() => setCopied(false), 1500);
    } catch { toast("Couldn't copy. Try downloading the transcript instead.", "error"); }
  };

  const download = (format: "txt" | "srt" | "vtt") => {
    try { downloadTranscript(format === "txt" ? text : subtitleText(draft.segments ?? [], format), format); }
    catch (err) { toast(err instanceof Error ? err.message : "Couldn't export subtitles.", "error"); }
  };

  const highlight = (next?: TranscriptDraft) => {
    if (next) setActiveSegment(activeCue(next.segments, playback.current?.position() ?? -1));
  };
  const commitSegments = (segments: TranscriptSegment[]) => {
    const problem = cueError(segments, document.audio_duration_seconds);
    if (problem) return problem;
    const next = transcriptDraft("", segments);
    editor.edit(next); highlight(next); caret.current = {};
    return null;
  };
  const travel = (back: boolean) => { highlight(back ? editor.undo() : editor.redo()); caret.current = {}; };
  const openAction = (kind: CueAction["kind"], index: number) => setAction({ kind, index,
    caret: caret.current[index], playhead: playback.current?.position() ?? null });

  return <div onKeyDownCapture={(event) => {
    if (action || (event.target as HTMLElement).closest('[role="dialog"]') || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y" && !event.shiftKey) {
      event.preventDefault(); travel(key === "z" && !event.shiftKey);
    }
  }}><Panel>
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
      <h2 className="mr-auto text-sm font-medium">{t("Transcript ")}<span className="secondary-khmer khmer font-normal text-ink-soft">· អត្ថបទ</span></h2>
      <Badge tone="teal">{t(LANG_LABEL[document.language_code] ?? document.language_code)}</Badge>
      {document.audio_duration_seconds != null && <Badge>{formatSeconds(document.audio_duration_seconds)}</Badge>}
      <span role="status" className={cx("text-xs", status === "error" || status === "conflict" ? "text-rose" : "text-ink-soft")}>{t(saveLabel)}</span>
    </div>
    {document.id && ownerId && <TranscriptAudio ref={playback} id={document.id} ownerId={ownerId}
      status={sourceRemoved ? "removed" : document.source_audio_status}
      onRemoved={() => { setSourceRemoved(true); setActiveSegment(-1); }}
      onPosition={(time) => {
        setActiveSegment(activeCue(draft.segments, time));
      }} />}
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
      <Segmented label={t("Transcript view")} value={view} onChange={setView} options={views} className="max-w-full flex-wrap [&_button]:px-2" />
      <div role="group" aria-label={t("Edit history")} className="flex gap-1.5">
        <Button variant="secondary" size="sm" disabled={!editor.canUndo || resolving} aria-keyshortcuts="Control+Z Meta+Z" onClick={() => travel(true)}>{t("Undo")}</Button>
        <Button variant="secondary" size="sm" disabled={!editor.canRedo || resolving} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" onClick={() => travel(false)}>{t("Redo")}</Button>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Transcript exports")}>
        <Download aria-hidden className="size-3.5 text-ink-soft" />
        {(["txt", "srt", "vtt"] as const).map((format) => <Button key={format} variant="secondary" size="sm"
          aria-label={t("Download {format}", { format: format.toUpperCase() })} disabled={format !== "txt" && !hasSubtitles}
          title={format !== "txt" && !hasSubtitles ? t("Subtitle export needs timestamps and non-empty cue text") : undefined}
          onClick={() => download(format)}>{format.toUpperCase()}</Button>)}
        <IconButton label={t("Copy")} onClick={copy}>{copied ? <Check className="size-4 text-teal" /> : <Copy className="size-4" />}</IconButton>
      </div>
    </div>
    {(error || status === "conflict") && <div role="alert" className="space-y-3 border-b border-line bg-surface-2 p-5">
      <p className="text-sm text-rose">{status === "conflict"
        ? t("This transcript changed elsewhere. Your edits are still here. Choose which version to keep.")
        : t("{error} Your edits are still in the editor; you can retry or download them.", { error: t(error ?? "") })}</p>
      <div className="flex flex-wrap gap-2">
        {status === "conflict" ? <>
          <Button variant="secondary" size="sm" disabled={resolving} onClick={async () => highlight(await editor.resolveConflict(false))}>{t("Load saved version")}</Button>
          <Button size="sm" loading={resolving} onClick={async () => highlight(await editor.resolveConflict(true))}>{t("Save my version")}</Button>
        </> : <Button variant="secondary" size="sm" onClick={() => editor.save()}>{t("Retry save")}</Button>}
      </div>
    </div>}
    {!draft.segments && <p className="border-b border-line px-5 py-3 text-xs leading-relaxed text-ink-soft">
      {t("Timestamps aren't available for this transcript. You can edit and download its text; transcribe the audio again for subtitle export.")}</p>}
    {view === "edit" ? <div className="space-y-4 p-5">
      <p className="text-xs leading-relaxed text-ink-soft">{document.id ? t("Changes save automatically.") : t("Sign in before transcribing to save future transcripts and edits.")}
        {draft.segments && <> {t("Edit text and timing, split at the text cursor, or merge with the next segment. You can undo every applied change.")}</>}</p>
      {draft.segments?.some((segment, index, all) => index + 1 < all.length && segment.end > all[index + 1].start)
        && <p role="note" className="text-xs leading-relaxed text-ink-soft">{t("Some segments overlap. Review their timing before exporting; intentional overlaps are allowed.")}</p>}
      {draft.segments ? draft.segments.map((segment, index) => <div key={index} data-active={activeSegment === index} className="block space-y-2 rounded-xl p-2 -m-2 data-[active=true]:bg-accent-soft data-[active=true]:ring-1 data-[active=true]:ring-accent">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span>{t("Segment ")}{index + 1}</span>{canSeek ? <button type="button" aria-label={t("Play segment {number}", { number: index + 1 })}
            aria-current={activeSegment === index ? "true" : undefined} onClick={() => playback.current?.seek(segment.start)}
            className="rounded-lg px-2 py-1 font-medium tabular-nums text-accent hover:bg-accent-soft">
            {subtitleTimestamp(segment.start)} – {subtitleTimestamp(segment.end)}</button>
            : <span className="tabular-nums">{subtitleTimestamp(segment.start)} – {subtitleTimestamp(segment.end)}</span>}
        </span>
        <Textarea aria-label={t("Segment {number} text", { number: index + 1 })} lang={document.language_code} className={cx(isKhmer && "khmer")}
          rows={2} maxLength={10000} disabled={resolving} value={segment.text}
          onSelect={(event) => { caret.current[index] = event.currentTarget.selectionStart; }}
          onChange={(event) => editor.edit(transcriptDraft("",
            draft.segments!.map((s, i) => i === index ? { ...s, text: event.target.value } : s)), `segment:${index}`)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={resolving} aria-label={t("Edit timing for segment {number}", { number: index + 1 })}
            onClick={() => openAction("timing", index)}>{t("Edit timing")}</Button>
          <Button variant="secondary" size="sm" disabled={resolving || draft.segments!.length >= 20000 || Math.round(segment.end * 1000) - Math.round(segment.start * 1000) < 2}
            aria-label={t("Split segment {number}", { number: index + 1 })} onClick={() => openAction("split", index)}>{t("Split")}</Button>
          <Button variant="secondary" size="sm" disabled={resolving || index === draft.segments!.length - 1}
            aria-label={t("Merge segment {number} with next", { number: index + 1 })} onClick={() => {
              const problem = commitSegments(mergeCue(draft.segments!, index));
              if (problem) toast(problem, "error");
            }}>{t("Merge next")}</Button>
        </div>
      </div>) : <Textarea aria-label={t("Transcript text")} lang={document.language_code} className={cx(isKhmer && "khmer")}
        rows={8} maxLength={500000} disabled={resolving} value={draft.text} onChange={(event) => editor.edit({ text: event.target.value, segments: null }, "text")} />}
    </div> : view === "timeline" ? <ol className="space-y-2 p-5">{draft.segments?.map((segment, index) => <li key={index}>
      <button type="button" disabled={!canSeek} aria-label={t("Play segment {number}", { number: index + 1 })}
        aria-current={activeSegment === index ? "true" : undefined} onClick={() => playback.current?.seek(segment.start)}
        className={cx("w-full rounded-xl p-3 text-left transition-colors disabled:cursor-default", canSeek && "hover:bg-surface-2",
          activeSegment === index && "bg-accent-soft ring-1 ring-accent")}>
        <span className="block text-xs tabular-nums text-ink-soft">{subtitleTimestamp(segment.start)} – {subtitleTimestamp(segment.end)}</span>
        <span lang={document.language_code} className={cx("mt-1 block whitespace-pre-wrap break-words text-sm", isKhmer && "khmer")}>{segment.text || t("(Empty cue)")}</span>
      </button>
    </li>)}</ol> : <div lang={document.language_code} className={cx("whitespace-pre-wrap break-words p-5 text-lg leading-relaxed", isKhmer && "khmer")}>
      {view === "text" && canSeek && draft.segments ? draft.segments.map((segment, index) => <span key={index}>
        {index > 0 && " "}<button type="button" aria-label={t("Play segment {number}", { number: index + 1 })}
          aria-current={activeSegment === index ? "true" : undefined} onClick={() => playback.current?.seek(segment.start)}
          className={cx("rounded-md px-0.5 text-left transition-colors hover:bg-surface-2", activeSegment === index && "bg-accent-soft ring-1 ring-accent")}>
          {segment.text || t("(Empty cue)")}</button>
      </span>) : text || <span className="text-ink-soft">{t("This transcript is empty. Choose Edit to add text.")}</span>}
    </div>}
  </Panel>
    {action && draft.segments && <CueDialog action={action} segments={draft.segments} language={document.language_code} canUsePlayback={canSeek}
      position={() => playback.current?.position() ?? null} onCommit={commitSegments} onClose={() => setAction(null)} />}
  </div>;
}
