"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { Button, Dialog, IconButton } from "@/components/ui";
import { api, sessionStore } from "@/lib/api";
import { formatSeconds } from "@/lib/format";
import { useT } from "@/lib/useLocale";
import type { TranscriptionDetail } from "@/lib/types";

export type TranscriptPlayback = { seek: (time: number) => void; position: () => number | null; preview: (time: number) => void };

/** Fetch only through the authenticated API; URLs and playback never outlive the editor. */
export const TranscriptAudio = forwardRef<TranscriptPlayback, {
  id: string; ownerId: string; status: TranscriptionDetail["source_audio_status"];
  onPosition: (time: number) => void; onRemoved: () => void;
}>(function TranscriptAudio({ id, ownerId, status, onPosition, onRemoved }, ref) {
  const t = useT();
  const audio = useRef<HTMLAudioElement>(null);
  const objectUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const playRequest = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const available = status === "available" || status === "pending";

  useEffect(() => {
    const element = audio.current;
    return () => {
      request.current?.abort();
      element?.pause();
      element?.removeAttribute("src");
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const load = async () => {
    if (objectUrl.current) return;
    if (inFlight.current) return inFlight.current;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(null);
    inFlight.current = (async () => {
      try {
        if (sessionStore.get()?.user.id !== ownerId) throw new Error("Please sign in first.");
        const response = await api(`/api/v1/transcriptions/${id}/source-audio`, { auth: "required", signal: controller.signal });
        const blob = await response.blob();
        if (controller.signal.aborted || sessionStore.get()?.user.id !== ownerId) return;
        objectUrl.current = URL.createObjectURL(blob);
        if (audio.current) { audio.current.src = objectUrl.current; audio.current.load(); }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn't load source audio.");
      } finally {
        inFlight.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return inFlight.current;
  };

  const updatePosition = () => {
    if (!audio.current) return;
    setPosition(audio.current.currentTime);
    onPosition(audio.current.currentTime);
  };
  const seek = (time: number) => {
    if (!audio.current || audio.current.readyState < 1) { pendingSeek.current = time; return; }
    audio.current.currentTime = Math.max(0, Math.min(time, audio.current.duration || 0));
    updatePosition();
  };
  const play = async (time?: number) => {
    if (!available || removing) return;
    const sequence = ++playRequest.current;
    setError(null);
    if (time !== undefined) pendingSeek.current = time;
    await load();
    if (sequence !== playRequest.current || !objectUrl.current || !audio.current || request.current?.signal.aborted) return;
    if (pendingSeek.current !== null && audio.current.readyState >= 1) {
      seek(pendingSeek.current); pendingSeek.current = null;
    }
    try { await audio.current.play(); }
    catch { if (sequence === playRequest.current && !request.current?.signal.aborted) setError("Couldn't play source audio. Try again."); }
  };
  useImperativeHandle(ref, () => ({ preview: (time) => {
    playRequest.current++;
    audio.current?.pause();
    if (audio.current && audio.current.readyState >= 1) seek(time);
    else pendingSeek.current = time;
  }, seek: (time) => { void play(time); },
    position: () => audio.current && audio.current.readyState >= 1 ? audio.current.currentTime : null }));

  const remove = async () => {
    playRequest.current++;
    setRemoving(true); setError(null); audio.current?.pause();
    try {
      await api(`/api/v1/transcriptions/${id}/source-audio`, { method: "DELETE", auth: "required" });
      request.current?.abort();
      audio.current?.removeAttribute("src"); audio.current?.load();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      setDeleting(false); onPosition(-1); onRemoved();
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't delete source audio."); }
    finally { setRemoving(false); }
  };

  const note = status === "storage_full" ? "Source audio wasn't saved because a storage limit was reached. Your transcript is safe."
    : status === "unavailable" ? "Source audio couldn't be saved. Your transcript is still available."
    : status === "removed" ? "Source audio was deleted. Your transcript and subtitles are still available."
    : "No source audio was saved for this transcript.";

  return <section aria-label={t("Source audio")} className="space-y-3 border-b border-line bg-surface-2/50 px-5 py-4">
    <audio ref={audio} preload="metadata" onTimeUpdate={updatePosition} onSeeked={updatePosition}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); onPosition(-1); }}
      onError={() => { if (audio.current?.getAttribute("src")) setError("Couldn't play source audio. Try again."); }}
      onLoadedMetadata={() => {
        const element = audio.current!;
        setDuration(Number.isFinite(element.duration) ? element.duration : 0);
        element.playbackRate = speed;
        if (pendingSeek.current !== null) { seek(pendingSeek.current); pendingSeek.current = null; }
        else updatePosition();
      }} />
    {available ? <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" loading={loading} disabled={removing}
          aria-label={t(playing ? "Pause source audio" : "Play source audio")}
          icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          onClick={() => { if (playing) audio.current?.pause(); else void play(); }}>
          {t(playing ? "Pause" : "Listen")}
        </Button>
        <IconButton label={t("Rewind 5 seconds")} disabled={!duration || removing} onClick={() => seek(position - 5)}><RotateCcw className="size-4" /></IconButton>
        <IconButton label={t("Forward 5 seconds")} disabled={!duration || removing} onClick={() => seek(position + 5)}><RotateCw className="size-4" /></IconButton>
        <label className="ml-auto text-xs text-ink-soft">
          <span className="sr-only">{t("Playback speed")}</span>
          <select aria-label={t("Playback speed")} value={speed} className="ink-field rounded-lg border bg-surface px-2 py-1.5" onChange={(event) => {
            const value = Number(event.target.value); setSpeed(value);
            if (audio.current) audio.current.playbackRate = value;
          }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}</select>
        </label>
        <IconButton label={t("Delete source audio")} disabled={removing} onClick={() => setDeleting(true)}><Trash2 className="size-4" /></IconButton>
      </div>
      <div className="flex items-center gap-3">
        <input type="range" aria-label={t("Source audio position")} min={0} max={duration || 1} step={0.01}
          value={Math.min(position, duration || 1)} disabled={!duration || removing} className="min-w-0 flex-1"
          onChange={(event) => seek(Number(event.target.value))} />
        <span className="shrink-0 text-xs tabular-nums text-ink-soft">{formatSeconds(position)} / {formatSeconds(duration)}</span>
      </div>
      <p className="text-xs leading-relaxed text-ink-soft">{t("Private recording. Click a segment to listen from its timestamp.")}</p>
    </> : <p className="text-xs leading-relaxed text-ink-soft">{t(note)}</p>}
    {error && <p role="alert" className="text-sm text-rose">{t(error)}</p>}
    <Dialog open={deleting} onClose={() => { if (!removing) setDeleting(false); }} title={t("Delete source audio?")}>
      <p className="mb-5 text-sm text-ink-soft">{t("This permanently deletes the recording. Your transcript, edits and subtitle exports stay available.")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={removing} onClick={() => setDeleting(false)}>{t("Keep audio")}</Button>
        <Button variant="danger" loading={removing} onClick={() => void remove()}>{t("Remove recording")}</Button>
      </div>
    </Dialog>
  </section>;
});
