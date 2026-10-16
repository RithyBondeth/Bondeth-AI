"use client";

import { Mic, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Badge, Button, Panel, PanelHeader, cx, useToast } from "@/components/ui";
import { API_URL, api, notifyUsageChanged, sessionStore } from "@/lib/api";
import { LANG_LABEL, formatSeconds } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";
import type { Lang, SttResult } from "@/lib/types";

/*
 * Live dictation: the microphone is downsampled to 16 kHz 16-bit PCM in an AudioWorklet
 * and streamed over a WebSocket (protocol in backend/app/api/v1/live.py). Finished
 * phrases arrive as "final", the phrase being spoken as "partial".
 */

// Box-filter downsampling to 16 kHz, posted every 100 ms with the input level for the UI.
const WORKLET = `
class Pcm16Downsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0; this.acc = 0; this.count = 0;
    this.out = new Int16Array(1600); this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let energy = 0;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      energy += x * x;
      this.acc += x; this.count++; this.phase += 1;
      if (this.phase >= this.ratio) {
        const v = Math.max(-1, Math.min(1, this.acc / this.count));
        this.out[this.n++] = v * 32767;
        this.phase -= this.ratio; this.acc = 0; this.count = 0;
        if (this.n === this.out.length) {
          this.port.postMessage({ pcm: this.out.buffer, level: Math.sqrt(energy / (i + 1)) }, [this.out.buffer]);
          this.out = new Int16Array(1600); this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm16-downsampler", Pcm16Downsampler);
`;

type Final = { text: string; segmented_text: string; start: number; end: number };
type Status = "idle" | "connecting" | "live" | "finishing";
type Done = { text: string; segmented_text: string; language: string | null; duration: number; transcription_id: string | null };

type Resources = { ws?: WebSocket; stream?: MediaStream; ctx?: AudioContext; timer?: ReturnType<typeof setInterval> };

export function LiveDictation({ lang, onResult }: { lang: Lang; onResult: (r: SttResult | null) => void }) {
  const toast = useToast();
  const hydrated = useHydrated();
  const [status, setStatus] = useState<Status>("idle");
  const [finals, setFinals] = useState<Final[]>([]);
  const [partial, setPartial] = useState("");
  const [language, setLanguage] = useState<string | null>(lang === "auto" ? null : lang);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const res = useRef<Resources>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const release = () => {
    const r = res.current;
    r.stream?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
    if (r.timer) clearInterval(r.timer);
    if (r.ws && r.ws.readyState <= WebSocket.OPEN) r.ws.close();
    res.current = {};
    setLevel(0);
  };

  // Stop everything when leaving the page.
  useEffect(() => () => release(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [finals, partial]);

  const start = async () => {
    onResult(null);
    setFinals([]);
    setPartial("");
    setSeconds(0);
    setLanguage(lang === "auto" ? null : lang);
    setStatus("connecting");
    const resources: Resources = {};
    res.current = resources;
    try {
      // Refresh the access token first if it has expired (a WebSocket can't do that mid-way).
      if (sessionStore.get()) await api("/api/v1/auth/me", { auth: "optional" }).catch(() => {});
      if (res.current !== resources) return;
      const token = sessionStore.get()?.access;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (res.current !== resources) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      // Register each resource immediately so setup failures/unmount can release it.
      resources.stream = stream;
      const ctx = new AudioContext();
      resources.ctx = ctx;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (res.current !== resources) return;
      const node = new AudioWorkletNode(ctx, "pcm16-downsampler");
      ctx.createMediaStreamSource(stream).connect(node);
      // Keep the worklet on a rendered graph in browsers that suspend dead ends.
      // A muted sink prevents playing the microphone back through the speakers.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
      await ctx.resume();
      if (res.current !== resources) return;

      const ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/api/v1/stt/live`);
      ws.binaryType = "arraybuffer";
      resources.ws = ws;

      let ready = false;
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
        setLevel(e.data.level);
        if (ready && ws.readyState === WebSocket.OPEN) ws.send(e.data.pcm);
      };
      ws.onopen = () => ws.send(JSON.stringify({ type: "start", language: lang, ...(token ? { token } : {}) }));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "ready") {
          ready = true;
          setStatus("live");
          const began = Date.now();
          res.current.timer = setInterval(() => setSeconds((Date.now() - began) / 1000), 250);
        } else if (msg.type === "partial") {
          setPartial(msg.text);
        } else if (msg.type === "final") {
          setFinals((list) => [...list, msg as Final]);
          setPartial("");
        } else if (msg.type === "done") {
          const done = msg as Done;
          setLanguage(done.language);
          if (done.text) {
            onResult({
              detected_language: done.language ?? "km", language_probability: 1, duration: done.duration,
              text: done.text, segmented_text: done.segmented_text, transcription_id: done.transcription_id,
              segments: [],
            });
            if (done.transcription_id) toast("Saved to your history", "success");
          } else {
            toast("No speech was heard. Check that the right microphone is selected.");
          }
        } else if (msg.type === "error") {
          toast(msg.detail, "error");
        }
      };
      ws.onclose = () => {
        notifyUsageChanged();
        release();
        setStatus("idle");
        setPartial("");
      };
      ws.onerror = () => toast("Lost the connection to the dictation server.", "error");
    } catch (err) {
      if (res.current !== resources) return;
      release();
      setStatus("idle");
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      toast(denied ? "Microphone access was blocked. Allow it in your browser to dictate." : "Couldn't start the microphone.", "error");
    }
  };

  const stop = () => {
    const r = res.current;
    setStatus("finishing");
    // Stop capturing, then ask the server to finish what it has.
    r.stream?.getTracks().forEach((t) => t.stop());
    if (r.timer) clearInterval(r.timer);
    if (r.ws?.readyState === WebSocket.OPEN) r.ws.send(JSON.stringify({ type: "stop" }));
    setLevel(0);
  };

  const live = status === "live";
  const isKhmer = (language ?? lang) !== "en";
  const words = finals.map((f) => f.text).join(" ");

  return (
    <Panel>
      <PanelHeader title="Live dictation" km="និយាយ → អក្សរ">
        {language && <Badge tone="teal">{LANG_LABEL[language] ?? language}</Badge>}
        {status !== "idle" && <Badge>{formatSeconds(seconds)}</Badge>}
      </PanelHeader>
      <div className="flex flex-col items-center gap-4 p-5">
        <div className="relative grid place-items-center py-2">
          <AnimatePresence>
            {live && (
              <motion.span className="absolute size-20 rounded-full bg-accent/25" initial={{ scale: 1, opacity: 0 }}
                animate={{ scale: 1 + Math.min(level * 6, 0.9), opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }} />
            )}
          </AnimatePresence>
          <motion.button type="button" whileTap={{ scale: 0.94 }} onClick={live ? stop : start}
            disabled={!hydrated || status === "connecting" || status === "finishing"}
            aria-label={live ? "Stop dictation" : "Start dictation"}
            className={cx("relative grid size-20 place-items-center rounded-full text-accent-ink shadow-panel transition-colors disabled:opacity-60",
              live ? "bg-rose" : "bg-accent")}>
            {live ? <Square className="size-7 fill-current" /> : <Mic className="size-8" />}
          </motion.button>
        </div>
        <p className="text-sm text-ink-soft" aria-live="polite">
          {status === "idle" && "Tap and start talking. Text appears as you speak."}
          {status === "connecting" && "Starting the microphone…"}
          {live && "Listening. Pause briefly between sentences; tap to stop."}
          {status === "finishing" && "Finishing the last words…"}
        </p>

        {(status !== "idle" || words) && (
          <div ref={scrollRef} lang={isKhmer ? "km" : "en"}
            className={cx("scroll-thin max-h-72 min-h-24 w-full overflow-y-auto rounded-xl bg-surface-2 p-4 text-lg leading-relaxed",
              isKhmer && "khmer")}>
            {words}
            {partial && <span className="text-ink-soft">{words ? " " : ""}{partial}</span>}
            {live && (
              <motion.span aria-hidden className="ml-1 inline-block h-5 w-0.5 translate-y-1 bg-accent"
                animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} />
            )}
            {!words && !partial && <span className="text-ink-faint">Your words will appear here…</span>}
          </div>
        )}
        {status === "finishing" && <Button variant="ghost" size="sm" loading>Finishing</Button>}
      </div>
    </Panel>
  );
}
