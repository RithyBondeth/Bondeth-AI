"use client";

import { Check, Copy, Download, History, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AudioInput, type AudioClip } from "@/components/audio/AudioInput";
import { NotebookDoodle, SpeakerDoodle, WaveformDoodle } from "@/components/doodles";
import { LiveDictation } from "@/components/studios/LiveDictation";
import { Intro, errorText } from "@/components/studios/shared";
import {
  Badge, Button, EmptyState, IconButton, LANGUAGE_OPTIONS, Panel, PanelHeader, Segmented, Setting, cx, useToast,
} from "@/components/ui";
import { apiJson, streamEvents } from "@/lib/api";
import { LANG_LABEL, formatSeconds } from "@/lib/format";
import { useUser } from "@/lib/hooks";
import type { Lang, SttJob, SttResult, SttSegment } from "@/lib/types";

type View = "text" | "words" | "timeline";

/** What's known while a job runs: its place in line, then the language and segments as they arrive. */
type Live = { position: number | null; info: { detected_language: string; duration: number } | null; segments: SttSegment[] };

export function SttStudio() {
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
      <Intro>Dictate live, or record and upload audio, in Khmer or English. Khmer comes back as clean text, with optional word boundaries.</Intro>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <Segmented label="Input" value={mode} onChange={(m) => { abortRef.current?.abort(); setMode(m); setResult(null); setBusy(false); setLive(null); }}
            options={[{ value: "live", label: "Live dictation" }, { value: "file", label: "Record or upload" }]} />
          {mode === "live" ? (
            <LiveDictation lang={lang} onResult={setResult} />
          ) : (
          <Panel>
            <PanelHeader title="Audio" km="សំឡេង" />
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
                {busy ? "Listening closely…" : "Transcribe"}
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
                  ? "Listening… the first words will appear here in a moment."
                  : live?.position && live.position > 1
                    ? `In line: ${live.position - 1} ahead of you.`
                    : "Uploading and starting up…"}
              </motion.div>
            ) : result?.text ? (
              <Transcript key={result.text} result={result} />
            ) : mode === "live" ? null : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Panel>
                  <EmptyState doodle={<SpeakerDoodle className="h-32 w-44 text-ink" />} title="Your transcript will appear here">
                    Pick a language on the right, or leave it on Auto to detect Khmer or English.
                  </EmptyState>
                </Panel>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader title="Settings" />
            <div className="space-y-6 p-5">
              <Setting label="Language">
                <Segmented full label="Language" value={lang} onChange={setLang} options={LANGUAGE_OPTIONS} />
              </Setting>
              <Setting label="Limits">
                <p className="text-sm text-ink-soft">Up to 200 MB per file: .wav, .mp3, .m4a, .webm, .ogg, .flac. Long recordings stream in as they&apos;re transcribed.</p>
              </Setting>
            </div>
          </Panel>
          <Panel className="overflow-hidden">
            <div className="flex items-center gap-4 p-5">
              <NotebookDoodle className="h-16 w-20 shrink-0 text-ink" />
              <div>
                <p className="text-sm font-medium">{user ? "History is on" : "Keep a history"}</p>
                <p className="text-xs text-ink-soft">
                  {user ? "Every transcript is saved to your library." : "Sign in and transcripts are saved automatically."}
                </p>
                <Link href={user ? "/history" : "/login?next=/stt"}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                  <History className="size-3.5" /> {user ? "Open history" : "Sign in"}
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
  const isKhmer = live.info?.detected_language === "km";
  const done = live.segments.at(-1)?.end ?? 0;
  const share = live.info?.duration ? Math.min(done / live.info.duration, 1) : 0;

  return (
    <Panel exit={{ opacity: 0, y: -8 }}>
      <PanelHeader title="Transcribing" km="កំពុងសរសេរ">
        {live.info && <Badge tone="teal">{LANG_LABEL[live.info.detected_language] ?? live.info.detected_language}</Badge>}
        {live.info && <Badge>{formatSeconds(done)} / {formatSeconds(live.info.duration)}</Badge>}
      </PanelHeader>
      <div className="h-1 bg-surface-2" role="progressbar" aria-label="Transcription progress"
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
  const toast = useToast();
  const isKhmer = result.detected_language === "km";
  const [view, setView] = useState<View>("text");
  const [copied, setCopied] = useState(false);
  const text = view === "words" ? result.segmented_text : result.text;

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast("Copied to clipboard", "success");
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "transcript.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const views: { value: View; label: string }[] = [
    { value: "text", label: "Text" },
    ...(isKhmer ? [{ value: "words" as const, label: "Words" }] : []),
    ...(result.segments.length > 1 ? [{ value: "timeline" as const, label: "Timeline" }] : []),
  ];

  return (
    <Panel exit={{ opacity: 0, y: -8 }}>
      <PanelHeader title="Transcript" km="អត្ថបទ">
        <Badge tone="teal">{LANG_LABEL[result.detected_language] ?? result.detected_language}</Badge>
        <Badge>{formatSeconds(result.duration)}</Badge>
        {result.transcription_id && <Badge tone="accent">Saved</Badge>}
      </PanelHeader>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
        {views.length > 1 && <Segmented label="View" value={view} onChange={setView} options={views} />}
        <div className="ml-auto flex gap-1">
          <IconButton label="Download as .txt" onClick={download}><Download className="size-4" /></IconButton>
          <IconButton label="Copy" onClick={copy}>{copied ? <Check className="size-4 text-teal" /> : <Copy className="size-4" />}</IconButton>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={view} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }} className="p-5">
          {view === "timeline" ? (
            <ol className="space-y-3">
              {result.segments.map((s, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                  className="grid grid-cols-[88px_1fr] gap-3 text-sm">
                  <span className="tabular-nums text-ink-soft">{formatSeconds(s.start)} – {formatSeconds(s.end)}</span>
                  <span className={cx(isKhmer && "khmer")}>{s.text}</span>
                </motion.li>
              ))}
            </ol>
          ) : (
            <p lang={isKhmer ? "km" : "en"} className={cx("text-lg leading-relaxed", isKhmer && "khmer")}>{text}</p>
          )}
        </motion.div>
      </AnimatePresence>
    </Panel>
  );
}
