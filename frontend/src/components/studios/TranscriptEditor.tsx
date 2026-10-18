"use client";

import { useT } from "@/lib/useLocale";

import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";

import { Badge, Button, IconButton, Panel, Segmented, Textarea, cx, useToast } from "@/components/ui";
import { LANG_LABEL, formatSeconds } from "@/lib/format";
import { downloadTranscript, subtitleText, subtitleTimestamp, transcriptDraft } from "@/lib/subtitles";
import type { TranscriptDocument } from "@/lib/types";
import { useTranscriptAutosave } from "@/lib/useTranscriptAutosave";

type View = "text" | "words" | "timeline" | "edit";

export function TranscriptEditor({ document, ownerId }: { document: TranscriptDocument; ownerId: string | null }) {
  const t = useT();
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

  return <Panel>
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
      <h2 className="mr-auto text-sm font-medium">{t("Transcript ")}<span className="secondary-khmer khmer font-normal text-ink-soft">· អត្ថបទ</span></h2>
      <Badge tone="teal">{t(LANG_LABEL[document.language_code] ?? document.language_code)}</Badge>
      {document.audio_duration_seconds != null && <Badge>{formatSeconds(document.audio_duration_seconds)}</Badge>}
      <span role="status" className={cx("text-xs", status === "error" || status === "conflict" ? "text-rose" : "text-ink-soft")}>{t(saveLabel)}</span>
    </div>
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
      <Segmented label={t("Transcript view")} value={view} onChange={setView} options={views} className="max-w-full flex-wrap [&_button]:px-2" />
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
          <Button variant="secondary" size="sm" disabled={resolving} onClick={() => editor.resolveConflict(false)}>{t("Load saved version")}</Button>
          <Button size="sm" loading={resolving} onClick={() => editor.resolveConflict(true)}>{t("Save my version")}</Button>
        </> : <Button variant="secondary" size="sm" onClick={() => editor.save()}>{t("Retry save")}</Button>}
      </div>
    </div>}
    {!draft.segments && <p className="border-b border-line px-5 py-3 text-xs leading-relaxed text-ink-soft">
      {t("Timestamps aren't available for this transcript. You can edit and download its text; transcribe the audio again for subtitle export.")}</p>}
    {view === "edit" ? <div className="space-y-4 p-5">
      <p className="text-xs leading-relaxed text-ink-soft">{document.id ? t("Changes save automatically.") : t("Sign in before transcribing to save future transcripts and edits.")}
        {draft.segments && t(" Correct each segment below. Subtitle timings stay unchanged.")}</p>
      {draft.segments ? draft.segments.map((segment, index) => <label key={index} className="block space-y-2">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span>{t("Segment ")}{index + 1}</span><span className="tabular-nums">{subtitleTimestamp(segment.start)} – {subtitleTimestamp(segment.end)}</span>
        </span>
        <Textarea aria-label={t("Segment {number} text", { number: index + 1 })} lang={document.language_code} className={cx(isKhmer && "khmer")}
          rows={2} maxLength={10000} disabled={resolving} value={segment.text} onChange={(event) => editor.edit(transcriptDraft("",
            draft.segments!.map((s, i) => i === index ? { ...s, text: event.target.value } : s)))} />
      </label>) : <Textarea aria-label={t("Transcript text")} lang={document.language_code} className={cx(isKhmer && "khmer")}
        rows={8} maxLength={500000} disabled={resolving} value={draft.text} onChange={(event) => editor.edit({ text: event.target.value, segments: null })} />}
    </div> : view === "timeline" ? <ol className="space-y-4 p-5">{draft.segments?.map((segment, index) => <li key={index} className="space-y-1">
      <p className="text-xs tabular-nums text-ink-soft">{subtitleTimestamp(segment.start)} – {subtitleTimestamp(segment.end)}</p>
      <p lang={document.language_code} className={cx("whitespace-pre-wrap break-words text-sm", isKhmer && "khmer")}>{segment.text || t("(Empty cue)")}</p>
    </li>)}</ol> : <p lang={document.language_code} className={cx("whitespace-pre-wrap break-words p-5 text-lg leading-relaxed", isKhmer && "khmer")}>
      {text || <span className="text-ink-soft">{t("This transcript is empty. Choose Edit to add text.")}</span>}
    </p>}
  </Panel>;
}
