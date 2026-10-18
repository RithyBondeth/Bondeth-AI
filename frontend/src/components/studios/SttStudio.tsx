"use client";

import { useT } from "@/lib/useLocale";

import { History, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AudioInput, type AudioClip } from "@/components/audio/AudioInput";
import { NotebookDoodle, SpeakerDoodle, WaveformDoodle } from "@/components/doodles";
import { LiveDictation } from "@/components/studios/LiveDictation";
import { SavedTranscript } from "@/components/studios/SavedTranscript";
import { TranscriptEditor } from "@/components/studios/TranscriptEditor";
import { Intro, errorText } from "@/components/studios/shared";
import {
  Badge, Button, EmptyState, LANGUAGE_OPTIONS, Panel, PanelHeader, Segmented, Setting, cx, useToast,
} from "@/components/ui";
import { apiJson, streamEvents } from "@/lib/api";
import { LANG_LABEL, formatSeconds } from "@/lib/format";
import { useUser } from "@/lib/hooks";
import type { Lang, SttJob, SttResult, SttSegment } from "@/lib/types";

/** What's known while a job runs: its place in line, then the language and segments as they arrive. */
type Live = { position: number | null; info: { detected_language: string; duration: number } | null; segments: SttSegment[] };

export function SttStudio() {
  const t = useT();
  const toast = useToast();
  const user = useUser();
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [lang, setLang] = useState<Lang>("auto");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [result, setResult] = useState<SttResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<"live" | "file">("live");

  // Stop following a job when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  const transcribe = async () => {
    if (!clip) return;
    abortRef.current?.abort();
    const abort = (abortRef.current = new AbortController());
    const form = new FormData();
    form.append("file", clip.blob, clip.filename);
    form.append("language", lang);
    setBusy(true);
    setResult(null);
    try {
      // Queued as a job so long recordings work and segments stream in as they're decoded.
      const job = await apiJson<SttJob>("/api/v1/stt/jobs", { method: "POST", body: form, auth: "optional", signal: abort.signal });
      setLive({ position: job.queue_position, info: null, segments: [] });
      let final: SttResult | null = null;
      await streamEvents(`/api/v1/stt/jobs/${job.job_id}/events`, ({ event, data }) => {
        if (event === "info") setLive((l) => l && { ...l, info: data as Live["info"] });
        else if (event === "segment") setLive((l) => l && { ...l, segments: [...l.segments, data as SttSegment] });
        else if (event === "done") final = data as SttResult;
        else if (event === "error") throw new Error((data as { error: string }).error);
      }, { auth: "optional", signal: abort.signal });
      if (!final) throw new Error("The transcription stopped unexpectedly. Please try again.");
      const res: SttResult = final;
      setResult(res);
      if (!res.text) toast("No speech was found in that audio.");
      else if (res.transcription_id) toast("Saved to your history", "success");
    } catch (err) {
      if (abort.signal.aborted) return;
      toast(err instanceof Error && !("status" in err) ? err.message : errorText(err, "Transcription failed."), "error");
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false);
        setLive(null);
      }
    }
  };

  return (
    <>
      <Intro>{t("Dictate live, or record and upload audio, in Khmer or English. Khmer comes back as clean text, with optional word boundaries.")}</Intro>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <Segmented label={t("Input")} value={mode} onChange={(m) => { abortRef.current?.abort(); setMode(m); setResult(null); setBusy(false); setLive(null); }}
            options={[{ value: "live", label: t("Live dictation") }, { value: "file", label: t("Record or upload") }]} />
          {mode === "live" ? (
            <LiveDictation lang={lang} onResult={setResult} />
          ) : (
          <Panel>
            <PanelHeader title={t("Audio")} km="សំឡេង" />
            <div className="space-y-4 p-5">
              <AudioInput value={clip} onChange={(c) => {
                abortRef.current?.abort();
                setClip(c);
                setResult(null);
                setBusy(false);
                setLive(null);
              }} />
              <Button className="w-full" size="lg" onClick={transcribe} disabled={!clip} loading={busy}
                icon={<Wand2 className="size-5" />}>
                {busy ? t("Listening closely…") : t("Transcribe")}
              </Button>
            </div>
          </Panel>
          )}

          <AnimatePresence mode="wait">
            {busy && live?.segments.length ? (
              <LiveTranscript key="live" live={live} />
            ) : busy ? (
              <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3 py-8 text-sm text-ink-soft">
                <motion.div animate={{ scaleY: [1, 0.55, 1.15, 1] }} transition={{ duration: 1.1, repeat: Infinity }}>
                  <WaveformDoodle className="h-14 w-36 text-ink" />
                </motion.div>
                {live?.info
                  ? t("Listening… the first words will appear here in a moment.")
                  : live?.position && live.position > 1
                    ? t("In line: {count} ahead of you.", { count: live.position - 1 })
                    : t("Uploading and starting up…")}
              </motion.div>
            ) : result?.text ? (
              <Transcript key={result.text} result={result} />
            ) : mode === "live" ? null : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Panel>
                  <EmptyState doodle={<SpeakerDoodle className="h-32 w-44 text-ink" />} title={t("Your transcript will appear here")}>
                    {t("Pick a language on the right, or leave it on Auto to detect Khmer or English.")}</EmptyState>
                </Panel>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader title={t("Settings")} />
            <div className="space-y-6 p-5">
              <Setting label={t("Language")}>
                <Segmented full label={t("Language")} value={lang} onChange={setLang} options={LANGUAGE_OPTIONS} />
              </Setting>
              <Setting label={t("Limits")}>
                <p className="text-sm text-ink-soft">{t("Up to 200 MB per file: .wav, .mp3, .m4a, .webm, .ogg, .flac. Long recordings stream in as they're transcribed.")}</p>
              </Setting>
            </div>
          </Panel>
          <Panel className="overflow-hidden">
            <div className="flex items-center gap-4 p-5">
              <NotebookDoodle className="h-16 w-20 shrink-0 text-ink" />
              <div>
                <p className="text-sm font-medium">{user ? t("History is on") : t("Keep a history")}</p>
                <p className="text-xs text-ink-soft">
                  {user ? t("Every transcript is saved to your library.") : t("Sign in and transcripts are saved automatically.")}
                </p>
                <Link href={user ? "/history" : "/login?next=/stt"}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                  <History className="size-3.5" /> {user ? t("Open history") : t("Sign in")}
                </Link>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function LiveTranscript({ live }: { live: Live }) {
  const t = useT();
  const isKhmer = live.info?.detected_language === "km";
  const done = live.segments.at(-1)?.end ?? 0;
  const share = live.info?.duration ? Math.min(done / live.info.duration, 1) : 0;

  return (
    <Panel exit={{ opacity: 0, y: -8 }}>
      <PanelHeader title={t("Transcribing")} km="កំពុងសរសេរ">
        {live.info && <Badge tone="teal">{t(LANG_LABEL[live.info.detected_language] ?? live.info.detected_language)}</Badge>}
        {live.info && <Badge>{formatSeconds(done)} / {formatSeconds(live.info.duration)}</Badge>}
      </PanelHeader>
      <div className="h-1 bg-surface-2" role="progressbar" aria-label={t("Transcription progress")}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <motion.div className="h-full bg-accent" initial={false} animate={{ width: `${share * 100}%` }} />
      </div>
      <p lang={isKhmer ? "km" : "en"} aria-live="polite" className={cx("p-5 text-lg leading-relaxed", isKhmer && "khmer")}>
        {live.segments.map((s, i) => (
          <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{i > 0 && " "}{s.text}</motion.span>
        ))}
        <motion.span aria-hidden className="ml-1 inline-block h-5 w-0.5 translate-y-1 bg-accent"
          animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} />
      </p>
    </Panel>
  );
}

function Transcript({ result }: { result: SttResult }) {
  const user = useUser();
  if (result.transcription_id && user) return <SavedTranscript id={result.transcription_id} />;
  return <TranscriptEditor ownerId={null} document={{ id: null, language_code: result.detected_language,
    transcribed_text: result.text, segments: result.segments.length ? result.segments : null,
    segmented_text: result.segmented_text, audio_duration_seconds: result.duration, revision: 1,
    updated_at: null, created_at: "" }} />;
}
