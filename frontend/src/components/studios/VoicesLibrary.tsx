"use client";

import { useT } from "@/lib/useLocale";

import { Pause, Pencil, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AudioInput, type AudioClip } from "@/components/audio/AudioInput";
import { TwinVoicesDoodle } from "@/components/doodles";
import { Intro, RequireAuth, errorText, useVoices } from "@/components/studios/shared";
import { Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Panel, Textarea, cx, useToast } from "@/components/ui";
import { api, apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Voice } from "@/lib/types";

const TINTS = ["bg-accent-soft text-accent", "bg-lilac-soft text-lilac", "bg-teal-soft text-teal"];

/** A coloured monogram for a voice, stable per name. */
export function VoiceAvatar({ name, className }: { name: string; className?: string }) {
  const tint = TINTS[[...name].reduce((n, ch) => n + ch.codePointAt(0)!, 0) % TINTS.length];
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-xl font-bold uppercase", tint, className)}>
      {[...name.trim()][0] ?? "?"}
    </span>
  );
}

export function ConsentCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
      <span>{t("This is ")}<strong>{t("my voice")}</strong>{t(", or I have the speaker's ")}<strong>{t("explicit permission")}</strong> {t(" to clone it.")}</span>
    </label>
  );
}

export function VoicesLibrary() {
  const t = useT();
  return (
    <>
      <Intro>{t("Save a clear 5–10 second sample of one speaker (3–30 seconds accepted), then clone it from Voice Clone.")}</Intro>
      <RequireAuth why={t("Saved voices are private to your account.")}>
        <Library />
      </RequireAuth>
    </>
  );
}

function Library() {
  const t = useT();
  const toast = useToast();
  const { voices, add, update, remove } = useVoices();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Voice | null>(null);

  const del = async (v: Voice) => {
    if (!confirm(t("Delete “{name}”? Its audio sample is removed too.", { name: v.voice_alias }))) return;
    try {
      await api(`/api/v1/voices/${v.id}`, { method: "DELETE", auth: "required" });
      remove(v.id);
      toast(t("Deleted “{name}”", { name: v.voice_alias }));
    } catch (err) {
      toast(errorText(err, "Couldn't delete the voice."), "error");
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <p className="text-sm text-ink-soft">{voices ? t("{count} saved", { count: voices.length }) : t("Loading…")}</p>
        <Button className="ml-auto" onClick={() => setAdding(true)} icon={<Plus className="size-4" />}>{t("Add voice")}</Button>
      </div>

      {voices === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((k) => <div key={k} className="h-48 animate-pulse rounded-2xl bg-surface" />)}
        </div>
      ) : voices.length === 0 ? (
        <Panel>
          <EmptyState doodle={<TwinVoicesDoodle className="h-28 w-44 text-ink" />} title={t("No voices yet")}
            action={<Button onClick={() => setAdding(true)} icon={<Plus className="size-4" />}>{t("Add your first voice")}</Button>}>
            {t("Record yourself for 5–10 seconds in a quiet room, or upload a clean sample of someone who agreed to be cloned.")}</EmptyState>
        </Panel>
      ) : (
        <motion.ul layout className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {voices.map((v, i) => (
              <VoiceCard key={v.id} voice={v} index={i} onEdit={() => setEditing(v)} onDelete={() => del(v)} />
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title={t("Add a voice")}>
        <AddVoiceForm onSaved={(v) => { add(v); setAdding(false); }} />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={t("Edit voice")}>
        {editing && <EditVoiceForm voice={editing} onSaved={(v) => { update(v); setEditing(null); }} />}
      </Dialog>
    </>
  );
}

function VoiceCard({ voice, index, onEdit, onDelete }: { voice: Voice; index: number; onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  const toast = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Stop playback and release the sample's object URL when the card goes away.
  useEffect(() => () => {
    const el = audioRef.current;
    if (el) { el.pause(); URL.revokeObjectURL(el.src); }
  }, []);

  const togglePlay = async () => {
    if (audioRef.current) {
      if (audioRef.current.paused) void audioRef.current.play();
      else audioRef.current.pause();
      return;
    }
    try {
      const blob = await (await api(`/api/v1/voices/${voice.id}/audio`, { auth: "required" })).blob();
      const el = new Audio(URL.createObjectURL(blob));
      el.onplay = () => setPlaying(true);
      el.onpause = el.onended = () => setPlaying(false);
      audioRef.current = el;
      void el.play();
    } catch (err) {
      toast(errorText(err, "Couldn't load the sample."), "error");
    }
  };

  return (
    <motion.li layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: index * 0.04 } }}
      exit={{ opacity: 0, scale: 0.95 }} whileHover={{ y: -3 }}
      className="group flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-panel">
      <div className="flex items-start gap-3">
        <VoiceAvatar name={voice.voice_alias} className="size-11 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{voice.voice_alias}</p>
          <p className="text-xs text-ink-soft">{formatDate(voice.created_at)}</p>
        </div>
        <Badge>{voice.reference_duration_seconds.toFixed(0)} {t("s")}</Badge>
      </div>

      <p className="khmer mt-3 line-clamp-3 flex-1 text-sm text-ink-soft">“{voice.reference_text}”</p>

      <div className="mt-4 flex items-center gap-1 border-t border-line pt-3">
        <motion.button type="button" onClick={togglePlay} whileTap={{ scale: 0.9 }}
          aria-label={playing ? t("Pause sample") : t("Play sample")}
          className="grid size-9 place-items-center rounded-full bg-lilac text-lilac-ink shadow-[0_6px_14px_-6px_var(--lilac)]">
          {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
        </motion.button>
        <Link href={`/clone?voice=${voice.id}`}
          className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink">
          <Sparkles className="size-4" /> {t(" Use")}</Link>
        <IconButton label={t("Edit")} onClick={onEdit} className="ml-auto"><Pencil className="size-4" /></IconButton>
        <IconButton label={t("Delete")} onClick={onDelete} className="hover:bg-rose-soft hover:text-rose"><Trash2 className="size-4" /></IconButton>
      </div>
    </motion.li>
  );
}

function AddVoiceForm({ onSaved }: { onSaved: (v: Voice) => void }) {
  const t = useT();
  const toast = useToast();
  const [alias, setAlias] = useState("");
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [transcript, setTranscript] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clip) return;
    const form = new FormData();
    form.append("voice_alias", alias.trim());
    form.append("reference_audio", clip.blob, clip.filename);
    form.append("consent", String(consent));
    if (transcript.trim()) form.append("reference_text", transcript.trim());
    setBusy(true);
    try {
      const voice = await apiJson<Voice>("/api/v1/voices", { method: "POST", body: form, auth: "required" });
      toast("Saved “{name}”", "success", { name: voice.voice_alias });
      onSaved(voice);
    } catch (err) {
      toast(errorText(err, "Couldn't save the voice."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label={t("Name")}>
        {(id) => <Input id={id} value={alias} onChange={(e) => setAlias(e.target.value)} required maxLength={100} placeholder={t("e.g. My narration voice")} autoFocus />}
      </Field>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t("Sample ")}<span className="font-normal text-ink-soft">(3–30 {t("s")})</span></p>
        <AudioInput value={clip} onChange={(next) => {
          setClip(next); setTranscript(""); setConsent(false);
        }} maxSeconds={30} compact preserveVoice />
      </div>
      <Field label={t("What's said in the sample (optional)")} hint={t("Exact words help the cloned voice match the speaker. Leave blank for automatic transcription, then check it before cloning.")}>
        {(id) => <Textarea id={id} rows={2} value={transcript} onChange={(e) => setTranscript(e.target.value)} className="khmer" />}
      </Field>
      <ConsentCheckbox checked={consent} onChange={setConsent} />
      <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!clip || !alias.trim() || !consent}>
        {busy ? t("Saving and transcribing…") : t("Save voice")}
      </Button>
    </form>
  );
}

function EditVoiceForm({ voice, onSaved }: { voice: Voice; onSaved: (v: Voice) => void }) {
  const t = useT();
  const toast = useToast();
  const [alias, setAlias] = useState(voice.voice_alias);
  const [transcript, setTranscript] = useState(voice.reference_text);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await apiJson<Voice>(`/api/v1/voices/${voice.id}`, {
        method: "PATCH", auth: "required",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_alias: alias.trim(), reference_text: transcript.trim() }),
      });
      toast("Voice updated", "success");
      onSaved(updated);
    } catch (err) {
      toast(errorText(err, "Couldn't update the voice."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label={t("Name")}>{(id) => <Input id={id} value={alias} onChange={(e) => setAlias(e.target.value)} required maxLength={100} />}</Field>
      <Field label={t("Transcript of the sample")} hint={t("An accurate transcript noticeably improves cloning quality.")}>
        {(id) => <Textarea id={id} rows={4} value={transcript} onChange={(e) => setTranscript(e.target.value)} required className="khmer" />}
      </Field>
      <Button type="submit" className="w-full" loading={busy} disabled={!alias.trim() || !transcript.trim()}>{t("Save changes")}</Button>
    </form>
  );
}
