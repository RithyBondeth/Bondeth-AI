"use client";

import { Check, Copy, Download, History, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { AudioInput, type AudioClip } from "@/components/audio/AudioInput";
import { MicDoodle, NotebookDoodle, WaveformDoodle } from "@/components/doodles";
import { Intro, errorText } from "@/components/studios/shared";
import {
  Badge, Button, EmptyState, IconButton, LANGUAGE_OPTIONS, Panel, PanelHeader, Segmented, Setting, cx, useToast,
} from "@/components/ui";
import { apiJson } from "@/lib/api";
import { LANG_LABEL, formatSeconds } from "@/lib/format";
import { useUser } from "@/lib/hooks";
import type { Lang, SttResult } from "@/lib/types";

type View = "text" | "words" | "timeline";

export function SttStudio() {
  const toast = useToast();
  const user = useUser();
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [lang, setLang] = useState<Lang>("auto");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SttResult | null>(null);

  const transcribe = async () => {
    if (!clip) return;
    const form = new FormData();
    form.append("file", clip.blob, clip.filename);
    form.append("language", lang);
    setBusy(true);
    setResult(null);
    try {
      const res = await apiJson<SttResult>("/api/v1/stt", { method: "POST", body: form, auth: "optional" });
      setResult(res);
      if (!res.text) toast("No speech was found in that audio.");
      else if (res.transcription_id) toast("Saved to your history", "success");
    } catch (err) {
      toast(errorText(err, "Transcription failed."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Intro>Record yourself or upload audio in Khmer or English. Khmer comes back as clean text, with optional word boundaries.</Intro>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader title="Audio" km="សំឡេង" />
            <div className="space-y-4 p-5">
              <AudioInput value={clip} onChange={(c) => { setClip(c); setResult(null); }} />
              <Button className="w-full" size="lg" onClick={transcribe} disabled={!clip} loading={busy}
                icon={<Wand2 className="size-5" />}>
                {busy ? "Listening closely…" : "Transcribe"}
              </Button>
            </div>
          </Panel>

          <AnimatePresence mode="wait">
            {busy ? (
              <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3 py-8 text-sm text-ink-soft">
                <motion.div animate={{ scaleY: [1, 0.55, 1.15, 1] }} transition={{ duration: 1.1, repeat: Infinity }}>
                  <WaveformDoodle className="h-14 w-36 text-ink" />
                </motion.div>
                Turning sound into words. Long clips take a little while.
              </motion.div>
            ) : result?.text ? (
              <Transcript key={result.text} result={result} />
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Panel>
                  <EmptyState doodle={<MicDoodle className="h-24 w-20 text-ink" />} title="Your transcript will appear here">
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
                <p className="text-sm text-ink-soft">Up to 25 MB per file: .wav, .mp3, .m4a, .webm, .ogg, .flac.</p>
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
