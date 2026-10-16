"use client";

import { Download, Pause, Play } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";
import { formatSeconds } from "@/lib/format";

const BAR_COUNT = 64;

/** Peak level per bar, decoded with Web Audio. Falls back to flat bars if decoding fails. */
async function computePeaks(blob: Blob): Promise<number[]> {
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
    const peaks = Array.from({ length: BAR_COUNT }, (_, b) => {
      let max = 0;
      for (let i = b * step; i < Math.min((b + 1) * step, data.length); i++) max = Math.max(max, Math.abs(data[i]));
      return max;
    });
    const top = Math.max(...peaks, 1e-6);
    return peaks.map((p) => Math.max(0.08, p / top));
  } catch {
    return Array(BAR_COUNT).fill(0.3);
  }
}

export function AudioPlayer({ blob, filename = "audio.wav", tone = "accent", compact = false, className }: {
  blob: Blob;
  filename?: string;
  tone?: "accent" | "teal" | "lilac";
  /** Smaller variant for lists. */
  compact?: boolean;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Create and revoke the object URL in the same effect. (A memoised URL revoked in cleanup
  // breaks under React's dev double-mount: the second mount reuses the revoked URL.)
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (audioRef.current) audioRef.current.src = url;
    if (linkRef.current) linkRef.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  useEffect(() => {
    let alive = true;
    computePeaks(blob).then((p) => alive && setPeaks(p));
    return () => { alive = false; };
  }, [blob]);

  const progress = duration ? time / duration : 0;
  const color = { accent: "var(--accent)", teal: "var(--teal)", lilac: "var(--lilac)" }[tone];

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  return (
    <div className={cx("flex min-w-0 items-center rounded-xl bg-surface-2", compact ? "gap-2 p-1.5 pr-2" : "gap-3 p-2.5 pr-3", className)}>
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
      />
      <motion.button
        type="button"
        onClick={toggle}
        whileTap={{ scale: 0.9 }}
        aria-label={playing ? "Pause" : "Play"}
        className={cx("grid shrink-0 place-items-center rounded-full text-white shadow-[0_6px_16px_-6px_currentColor]", compact ? "size-8" : "size-10")}
        style={{ background: color, color }}
      >
        {playing
          ? <Pause className={cx("fill-white text-white", compact ? "size-3.5" : "size-4")} />
          : <Play className={cx("ml-0.5 fill-white text-white", compact ? "size-3.5" : "size-4")} />}
      </motion.button>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        onClick={seek}
        onKeyDown={(e) => {
          const el = audioRef.current;
          if (!el) return;
          if (e.key === "ArrowRight") el.currentTime = Math.min(duration, el.currentTime + 2);
          if (e.key === "ArrowLeft") el.currentTime = Math.max(0, el.currentTime - 2);
          if (e.key === " ") { e.preventDefault(); toggle(); }
        }}
        className={cx("flex min-w-0 flex-1 cursor-pointer items-center gap-[2px] overflow-hidden", compact ? "h-7" : "h-10")}
      >
        {(peaks ?? Array(BAR_COUNT).fill(0.15)).filter((_, i) => !compact || i % 2 === 0).map((p, i, bars) => (
          <motion.span
            key={i}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: p }}
            transition={{ delay: i * 0.008, type: "spring", stiffness: 300, damping: 20 }}
            className="h-full flex-1 origin-center rounded-full transition-colors duration-150"
            style={{ background: i / bars.length < progress ? color : "var(--line)" }}
          />
        ))}
      </div>

      <span className={cx("shrink-0 text-right text-xs tabular-nums text-ink-soft", compact ? "w-9" : "w-20")}>
        {compact ? formatSeconds(duration) : `${formatSeconds(time)} / ${formatSeconds(duration)}`}
      </span>
      <a ref={linkRef} download={filename} aria-label="Download audio" title="Download"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface hover:text-ink">
        <Download className="size-4" />
      </a>
    </div>
  );
}
