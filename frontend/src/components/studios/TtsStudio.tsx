"use client";

import { ArrowRight, AudioLines } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { HeadphonesDoodle } from "@/components/doodles";
import { RecentsPanel, useRecents } from "@/components/shell/Recents";
import { Intro, errorText } from "@/components/studios/shared";
import { Badge, Button, LANGUAGE_OPTIONS, Panel, PanelHeader, Segmented, Setting, Slider, cx, useToast } from "@/components/ui";
import { api, apiJson } from "@/lib/api";
import { LANG_LABEL } from "@/lib/format";
import type { Lang, TtsPreview } from "@/lib/types";

const MAX_CHARS = 2000;

export const SAMPLES = [
  { label: "ខ្មែរ", text: "សួស្តី! ថ្ងៃនេះអាកាសធាតុល្អណាស់។ តើអ្នកសុខសប្បាយទេ?" },
  { label: "Numbers", text: "តម្លៃ $25.50 នៅថ្ងៃទី 13/10/2026 បញ្ចុះតម្លៃ 20%។" },
  { label: "Mixed", text: "ខ្ញុំប្រើ Facebook និង YouTube រាល់ថ្ងៃ។" },
  { label: "English", text: "Welcome to Bondeth AI. It costs $7 per month." },
];

/** The big text box with sample chips and a generate bar, shared by TTS and Voice Clone. */
export function Editor({ text, setText, max, busy, disabled, onGenerate, cta, busyLabel }: {
  text: string; setText: (t: string) => void; max: number; busy: boolean; disabled?: boolean;
  onGenerate: () => void; cta: string; busyLabel: string;
}) {
  return (
    <Panel className="@container/editor">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2">
        <h2 className="whitespace-nowrap text-sm font-medium">Text <span className="khmer font-normal text-ink-soft">· អត្ថបទ</span></h2>
        <div role="group" aria-label="Sample texts" className="hidden basis-full flex-wrap items-center gap-1 sm:flex @[28rem]/editor:ml-auto @[28rem]/editor:basis-auto">
          {SAMPLES.map((s) => (
          <motion.button key={s.label} type="button" whileTap={{ scale: 0.94 }} onClick={() => setText(s.text)}
            className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink">
            <span className={s.label === "ខ្មែរ" ? "khmer" : undefined}>{s.label}</span>
          </motion.button>
          ))}
        </div>
      </div>
      <textarea
        aria-label="Text to speak"
        value={text}
        maxLength={max}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !disabled && !busy) onGenerate(); }}
        placeholder="សរសេរអ្វីមួយ… Start typing in Khmer or English"
        className="khmer block min-h-56 w-full resize-y bg-transparent px-5 py-4 text-lg leading-relaxed placeholder:text-ink-faint focus:outline-none"
      />
      <div className="flex items-center gap-3 border-t border-line px-5 py-3">
        <span className={cx("shrink-0 whitespace-nowrap text-xs tabular-nums", text.length > max * 0.9 ? "text-rose" : "text-ink-soft")}>
          {text.length.toLocaleString()} / {max.toLocaleString()}
        </span>
        <span className="hidden whitespace-nowrap text-xs text-ink-faint @[28rem]/editor:inline">⌘/Ctrl + Enter</span>
        <Button className="ml-auto shrink-0 whitespace-nowrap" onClick={onGenerate} loading={busy} disabled={disabled || !text.trim()}
          icon={<AudioLines className="size-4" />}>
          {busy ? busyLabel : cta}
        </Button>
      </div>
    </Panel>
  );
}

export function TtsStudio() {
  const toast = useToast();
  const { add } = useRecents();
  const [text, setText] = useState(SAMPLES[0].text);
  const [lang, setLang] = useState<Lang>("auto");
  const [speed, setSpeed] = useState(1);
  const [preview, setPreview] = useState<TtsPreview | null>(null);
  const [busy, setBusy] = useState(false);

  // Live preview of what each voice will read, debounced while typing.
  useEffect(() => {
    if (!text.trim()) return;
    const timer = setTimeout(async () => {
      try {
        setPreview(await apiJson<TtsPreview>("/api/v1/tts/preview", {
          method: "POST", auth: "none",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang, speed }),
        }));
      } catch {
        setPreview(null);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [text, lang, speed]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await api("/api/v1/tts", {
        method: "POST", auth: "optional",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang, speed }),
      });
      const engine = res.headers.get("X-TTS-Engine");
      const fallback = res.headers.get("X-TTS-Fallback") === "short-khmer-omni-failed";
      const voice = fallback ? "MMS fallback — different voice" :
        engine === "omnivoice" ? "OmniVoice" : engine === "mms" ? "MMS" :
        engine === "voxcpm" ? "VoxCPM2" : "Standard voice";
      add({ kind: "tts", text, voice, blob: await res.blob(),
        notice: fallback ? "OmniVoice could not speak this short Khmer phrase. This clip uses MMS, a different speaker. Try again to retry OmniVoice." : undefined });
    } catch (err) {
      toast(errorText(err, "Couldn't generate speech."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Intro>Type Khmer, English, or both in one sentence. Numbers, prices, percentages and dates are read out in full.</Intro>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <Editor text={text} setText={setText} max={MAX_CHARS} busy={busy} onGenerate={generate}
            cta="Generate speech" busyLabel="Generating…" />
          <RecentsPanel kind="tts" />
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader title="Settings" />
            <div className="space-y-6 p-5">
              <Setting label="Main language">
                <Segmented full label="Main language" value={lang} onChange={setLang} options={LANGUAGE_OPTIONS} />
              </Setting>
              <Setting label="Speed" value={`${speed.toFixed(1)}×`}>
                <Slider label="Speed" min={0.5} max={2} step={0.1} value={speed} onChange={setSpeed} />
              </Setting>
              <Setting label="Voice">
                <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                  <HeadphonesDoodle className="h-10 w-11 shrink-0 text-ink" />
                  <div className="text-sm">
                    <p className="font-medium">{preview?.engine === "omnivoice" ? "OmniVoice · main voice" : "Standard voice"}</p>
                    <Link href="/clone" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                      Use your own voice <ArrowRight className="size-3" />
                    </Link>
                  </div>
                </div>
                {preview?.engine === "omnivoice" && (
                  <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                    If a short Khmer phrase fails, a clearly labelled MMS fallback uses a different speaker.
                  </p>
                )}
              </Setting>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="How it will be read" />
            <div className="p-4">
              {!text.trim() || !preview ? (
                <p className="px-1 py-4 text-sm text-ink-soft">Start typing to see how each part will be spoken.</p>
              ) : (
                <motion.ul layout className="space-y-2">
                  <AnimatePresence initial={false} mode="popLayout">
                    {preview.chunks.map((c, i) => (
                      <motion.li key={`${i}-${c.lang}-${c.text}`} layout
                        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
                        className={cx("rounded-xl p-3", c.lang === "km" ? "bg-accent-soft" : "bg-teal-soft")}>
                        <Badge tone={c.lang === "km" ? "accent" : "teal"}>{LANG_LABEL[c.lang]}</Badge>
                        <p lang={c.lang} className={cx("mt-1 text-sm", c.lang === "km" && "khmer")}>{c.text}</p>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
