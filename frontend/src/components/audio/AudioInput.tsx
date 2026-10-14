"use client";

import { Mic, Square, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { IconButton, cx, useToast } from "@/components/ui";
import { extensionForMime, formatSeconds } from "@/lib/format";

export type AudioClip = { blob: Blob; filename: string };

const LEVEL_BARS = 28;

/**
 * Record from the microphone or drop/choose a file. The large variant is the centrepiece
 * of the speech-to-text workspace; the compact one fits in forms and dialogs.
 */
export function AudioInput({ value, onChange, maxSeconds = 300, compact = false }: {
  value: AudioClip | null;
  onChange: (clip: AudioClip | null) => void;
  maxSeconds?: number;
  compact?: boolean;
}) {
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [dragging, setDragging] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  useEffect(() => () => cleanupRef.current(), []);
  useEffect(() => {
    if (recording && elapsed >= maxSeconds) stop();
  }, [recording, elapsed, maxSeconds, stop]);

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast("Microphone access was blocked. Allow it in your browser, or upload a file instead.", "error");
      return;
    }

    // Live level meter: bar heights are written straight to the DOM each frame (no re-renders).
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const levels = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const draw = () => {
      analyser.getByteFrequencyData(levels);
      barsRef.current.forEach((bar, i) => {
        // Mirror the spectrum so the meter is symmetric around the centre.
        const bin = Math.abs(i - LEVEL_BARS / 2);
        if (bar) bar.style.transform = `scaleY(${Math.max(0.1, levels[bin % levels.length] / 255)})`;
      });
      frame = requestAnimationFrame(draw);
    };
    draw();

    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 200);

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      cleanupRef.current();
      onChange({ blob: new Blob(chunks, { type: recorder.mimeType }), filename: `recording.${extensionForMime(recorder.mimeType)}` });
    };

    cleanupRef.current = () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      setRecording(false);
    };

    recorderRef.current = recorder;
    recorder.start();
    setElapsed(0);
    setRecording(true);
  };

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|webm|ogg|flac|aac|mp4)$/i.test(file.name)) {
      toast("That doesn't look like an audio file.", "error");
      return;
    }
    onChange({ blob: file, filename: file.name });
  };

  if (value && !recording) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
        <AudioPlayer blob={value.blob} filename={value.filename} tone="teal" className="flex-1" />
        <IconButton label="Remove audio" onClick={() => onChange(null)} className="hover:bg-rose-soft hover:text-rose">
          <X className="size-4" />
        </IconButton>
      </motion.div>
    );
  }

  const orbSize = compact ? "size-14" : "size-28";

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files[0]); }}
      className={cx(
        "relative flex items-center rounded-2xl border border-dashed transition-colors",
        dragging ? "border-accent bg-accent-soft" : "border-line",
        compact ? "gap-4 p-4" : "dot-grid flex-col gap-6 px-6 py-12 text-center",
      )}
    >
      <div className="relative grid place-items-center">
        {/* Idle: a slow breathing halo. Recording: expanding ripples. */}
        {!compact && !recording && (
          <motion.span className="absolute inset-0 rounded-full bg-accent/25 blur-xl"
            animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0.9, 0.6] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }} />
        )}
        <AnimatePresence>
          {recording && [0, 1, 2].map((ring) => (
            <motion.span key={ring} className="absolute inset-0 rounded-full border-2 border-rose"
              initial={{ opacity: 0.6, scale: 1 }} animate={{ opacity: 0, scale: 2 }} exit={{ opacity: 0 }}
              transition={{ duration: 2, repeat: Infinity, delay: ring * 0.65, ease: "easeOut" }} />
          ))}
        </AnimatePresence>
        <motion.button
          type="button"
          onClick={recording ? stop : start}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.93 }}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className={cx(
            "relative grid place-items-center rounded-full text-white transition-colors",
            "shadow-[inset_0_2px_0_rgb(255_255_255/0.3),0_14px_30px_-10px_currentColor]",
            orbSize,
            recording ? "bg-rose text-rose" : "bg-accent text-accent",
          )}
        >
          {recording
            ? <Square className={cx("fill-white text-white", compact ? "size-5" : "size-8")} />
            : <Mic className={cx("text-white", compact ? "size-6" : "size-10")} />}
        </motion.button>
      </div>

      {recording ? (
        <div className={cx("flex flex-col gap-2", compact ? "flex-1" : "items-center")}>
          <div className="flex h-12 items-center gap-1" aria-hidden>
            {Array.from({ length: compact ? 16 : LEVEL_BARS }, (_, i) => (
              <span key={i} ref={(el) => { barsRef.current[i] = el; }}
                className="h-full w-1 origin-center rounded-full bg-rose transition-transform duration-75" />
            ))}
          </div>
          <p className="text-sm tabular-nums text-ink-soft">
            <span className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-rose" />
            {formatSeconds(elapsed)} / {formatSeconds(maxSeconds)} · tap to stop
          </p>
        </div>
      ) : (
        <div className={cx("space-y-1", compact && "flex-1")}>
          <p className={cx("font-medium", !compact && "text-lg")}>
            {compact ? "Record or drop a file" : "Tap to record"}
          </p>
          <p className="text-sm text-ink-soft">
            {compact ? `Up to ${formatSeconds(maxSeconds)}` : "or drop an audio file anywhere in this box"}
          </p>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-accent hover:underline">
            <Upload className="size-4" /> Choose a file
          </button>
          <input ref={fileRef} type="file" accept="audio/*,.m4a,.webm" className="hidden"
            onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      )}
    </div>
  );
}
