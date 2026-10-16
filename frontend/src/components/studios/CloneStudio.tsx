"use client";

import { Check, Plus, ShieldCheck, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import { AudioInput, type AudioClip } from "@/components/audio/AudioInput";
import { NotebookDoodle } from "@/components/doodles";
import { RecentsPanel, useRecents } from "@/components/shell/Recents";
import { Editor } from "@/components/studios/TtsStudio";
import { ConsentCheckbox, VoiceAvatar } from "@/components/studios/VoicesLibrary";
import { Intro, RequireAuth, errorText, useVoices } from "@/components/studios/shared";
import { Field, LANGUAGE_OPTIONS, Panel, PanelHeader, Segmented, Setting, Slider, Textarea, cx, useToast } from "@/components/ui";
import { api, apiJson } from "@/lib/api";
import { formatSeconds } from "@/lib/format";
import type { CloneJob, Lang, Voice } from "@/lib/types";

const MAX_CHARS = 500;

type Source = { kind: "voice"; id: string } | { kind: "upload" };

export function CloneStudio() {
  return (
    <>
      <Intro>Pick a saved voice, or a one-off sample, and make it say anything in Khmer or English.</Intro>
      <RequireAuth why="Accounts keep your saved voices private and record who confirmed consent for each one.">
        <Studio />
      </RequireAuth>
    </>
  );
}

function Studio() {
  const toast = useToast();
  const { add } = useRecents();
  const { voices } = useVoices();
  const [source, setSource] = useState<Source | null>(null);
  const [text, setText] = useState("សួស្តី! នេះជាសំឡេងរបស់ខ្ញុំ ដែលបង្កើតដោយ Bondeth AI។");
  const [lang, setLang] = useState<Lang>("auto");
  const [speed, setSpeed] = useState(1);
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [referenceText, setReferenceText] = useState("");
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<CloneJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // What was sent, so the result is labelled correctly even if the editor changes mid-job.
  const submitted = useRef({ text: "", voice: "" });

  // Default to the voice requested via /clone?voice=…, else the newest saved voice.
  useEffect(() => {
    if (!voices || source) return;
    const wanted = new URLSearchParams(window.location.search).get("voice");
    const pick = voices.find((v) => v.id === wanted) ?? voices[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSource(pick ? { kind: "voice", id: pick.id } : { kind: "upload" });
  }, [voices, source]);

  const voice = voices?.find((v) => source?.kind === "voice" && v.id === source.id);
  const ready = source?.kind === "voice" ? !!voice : !!clip && consent;
  const working = submitting || job?.status === "queued" || job?.status === "running";

  const submit = async () => {
    const form = new FormData();
    form.append("text", text);
    form.append("lang", lang);
    form.append("speed", String(speed));
    if (source?.kind === "voice") form.append("voice_id", source.id);
    else if (clip) {
      form.append("reference_audio", clip.blob, clip.filename);
      form.append("consent", String(consent));
      if (referenceText.trim()) form.append("reference_text", referenceText.trim());
    }
    submitted.current = { text, voice: voice?.voice_alias ?? "One-off sample" };
    setSubmitting(true);
    setJob(null);
    try {
      setJob(await apiJson<CloneJob>("/api/v1/clone", { method: "POST", body: form, auth: "required" }));
    } catch (err) {
      toast(errorText(err, "Couldn't start cloning."), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const onDone = useCallback(async (done: CloneJob) => {
    setJob(done);
    if (done.status !== "done") return;
    try {
      const blob = await (await api(`/api/v1/clone/jobs/${done.job_id}/audio`, { auth: "required" })).blob();
      add({ kind: "clone", ...submitted.current, blob });
    } catch (err) {
      toast(errorText(err, "Couldn't download the result."), "error");
    }
  }, [add, toast]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        <Editor text={text} setText={setText} max={MAX_CHARS} busy={working} disabled={!ready} onGenerate={submit}
          cta="Clone & speak" busyLabel="Cloning…" />
        <AnimatePresence>
          {job && (job.status === "queued" || job.status === "running" || job.status === "failed") && (
            <JobProgress key={job.job_id} job={job} onFinished={onDone} />
          )}
        </AnimatePresence>
        <RecentsPanel kind="clone" />
      </div>

      <aside className="min-w-0 space-y-6">
        <Panel>
          <PanelHeader title="Voice" km="សំឡេង">
            <Link href="/voices" className="rounded-lg px-2 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2 hover:text-ink">Manage</Link>
          </PanelHeader>
          <div className="space-y-1.5 p-3" role="radiogroup" aria-label="Voice to use">
            {voices === null ? (
              [0, 1].map((k) => <div key={k} className="h-14 animate-pulse rounded-xl bg-surface-2" />)
            ) : (
              <>
                {voices.map((v) => (
                  <VoiceOption key={v.id} voice={v} selected={source?.kind === "voice" && source.id === v.id}
                    onSelect={() => setSource({ kind: "voice", id: v.id })} />
                ))}
                <button type="button" role="radio" aria-checked={source?.kind === "upload"} onClick={() => setSource({ kind: "upload" })}
                  className={cx("flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors",
                    source?.kind === "upload" ? "bg-accent-soft" : "hover:bg-surface-2")}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-ink-faint text-ink-soft">
                    <Upload className="size-4" />
                  </span>
                  <span className="text-sm">
                    <span className="block font-medium">One-off sample</span>
                    <span className="text-xs text-ink-soft">Upload or record just for this clip</span>
                  </span>
                </button>
                {voices.length === 0 && (
                  <Link href="/voices" className="flex items-center gap-2 rounded-xl p-2.5 text-sm font-medium text-accent hover:bg-surface-2">
                    <Plus className="size-4" /> Save a voice to reuse it
                  </Link>
                )}
              </>
            )}
          </div>
          <AnimatePresence initial={false}>
            {source?.kind === "upload" && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <div className="space-y-3 border-t border-line p-4">
                  <AudioInput value={clip} onChange={(next) => {
                    setClip(next); setReferenceText(""); setConsent(false);
                  }} maxSeconds={30} compact preserveVoice />
                  <Field label="Reference transcript (optional)"
                    hint="Type exactly what the speaker says, not the new text above. Leave blank for automatic transcription.">
                    {(id) => <Textarea id={id} value={referenceText} onChange={(e) => setReferenceText(e.target.value)}
                      rows={3} className="khmer" maxLength={3000} disabled={working} />}
                  </Field>
                  <ConsentCheckbox checked={consent} onChange={setConsent} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="border-t border-line p-4 text-xs leading-relaxed text-ink-soft">
            For the closest match, use 5–10 seconds of one speaker in a quiet room, with no music or echo.
            Use Khmer reference speech for Khmer output and keep speed at 1×. Check a saved voice&apos;s
            transcript in <Link href="/voices" className="font-medium text-accent underline">Manage voices</Link>.
          </p>
        </Panel>

        <Panel>
          <PanelHeader title="Settings" />
          <div className="space-y-6 p-5">
            <Setting label="Language">
              <Segmented full label="Language" value={lang} onChange={setLang} options={LANGUAGE_OPTIONS} />
            </Setting>
            <Setting label="Speed" value={`${speed.toFixed(1)}×`}>
              <Slider label="Speed" min={0.5} max={2} step={0.1} value={speed} onChange={setSpeed} />
            </Setting>
          </div>
        </Panel>

        <Panel className="flex items-center gap-3 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lilac-soft text-lilac">
            <ShieldCheck className="size-5" />
          </span>
          <p className="text-xs text-ink-soft">Only clone voices you own or have explicit permission to use.</p>
        </Panel>
      </aside>
    </div>
  );
}

function VoiceOption({ voice, selected, onSelect }: { voice: Voice; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cx("relative flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors",
        selected ? "text-ink" : "hover:bg-surface-2")}>
      {selected && (
        <motion.span layoutId="voice-selected" className="absolute inset-0 rounded-xl bg-lilac-soft"
          transition={{ type: "spring", stiffness: 420, damping: 34 }} />
      )}
      <VoiceAvatar name={voice.voice_alias} className="relative size-9 text-sm" />
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{voice.voice_alias}</span>
        <span className="khmer block truncate text-xs leading-snug text-ink-soft">{voice.reference_text}</span>
      </span>
      {selected && <Check className="relative size-4 shrink-0 text-lilac" />}
    </button>
  );
}

/** Polls a clone job until it finishes. */
function JobProgress({ job: initial, onFinished }: { job: CloneJob; onFinished: (job: CloneJob) => void }) {
  const [job, setJob] = useState(initial);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  // Read the latest callback without restarting the polling loop when it changes.
  const finished = useEffectEvent(onFinished);

  useEffect(() => {
    if (initial.status === "failed") return;
    started.current = Date.now();
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 500);

    const poll = async () => {
      try {
        const next = await apiJson<CloneJob>(`/api/v1/clone/jobs/${initial.job_id}`, { auth: "required" });
        if (!alive) return;
        setJob(next);
        if (next.status === "done" || next.status === "failed") {
          clearInterval(tick);
          finished(next);
          return;
        }
      } catch {
        // Network blip: keep polling.
      }
      if (alive) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 800);
    return () => { alive = false; clearTimeout(timer); clearInterval(tick); };
  }, [initial.job_id, initial.status]);

  return (
    <Panel initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <motion.div animate={job.status === "failed" ? {} : { rotate: [0, -6, 6, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
          <NotebookDoodle className="h-14 w-16 text-ink" />
        </motion.div>
        <div className="min-w-0 flex-1">
          {job.status === "failed" ? (
            <>
              <p className="font-medium text-rose">That didn&apos;t work</p>
              <p className="text-sm text-ink-soft">{job.error}</p>
            </>
          ) : (
            <>
              <p className="font-medium">
                {job.status === "queued"
                  ? job.queue_position && job.queue_position > 1 ? `In line: ${job.queue_position - 1} ahead of you` : "Up next…"
                  : "Sketching the voice…"}
              </p>
              <p className="text-sm text-ink-soft">Quality-first generation can take a minute or more · {formatSeconds(elapsed)}</p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <motion.div className="h-full w-1/3 rounded-full bg-gradient-to-r from-lilac to-accent"
                  animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />
              </div>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
