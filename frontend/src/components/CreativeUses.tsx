"use client";

import { ArrowRight, Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import { CreatorDoodle, DeveloperDoodle, IdeasDoodle } from "@/components/doodles";
import { cx } from "@/components/ui";

const USES = [
  {
    title: "Make content", hint: "Give stories a voice.", audience: "For creators",
    heading: "From a written idea to something worth hearing.",
    description: "Write a narration in Khmer or English, turn it into speech, and download the audio for your next lesson, story, or video.",
    detail: "Write in either language", secondDetail: "Download your generated audio",
    action: "Create a voiceover", href: "/tts", Art: CreatorDoodle,
    label: "A doodle of a creator recording a tutorial with a laptop and microphone",
  },
  {
    title: "Capture ideas", hint: "Say it before it slips away.", audience: "For everyday ideas",
    heading: "Less typing. More room for your thoughts.",
    description: "Talk through a thought or upload a recording. Turn your words into a transcript you can edit, copy, and come back to.",
    detail: "Record or upload a file", secondDetail: "Keep editable transcripts",
    action: "Start a transcript", href: "/stt", Art: IdeasDoodle,
    label: "A doodle of someone capturing a spoken idea with a phone and notebook",
  },
  {
    title: "Build with voice", hint: "Make your app speak Khmer.", audience: "For developers",
    heading: "A voice toolkit for the things you build.",
    description: "Bring transcription, speech generation, and consented voice cloning into your own app. Create a separate API key for each project.",
    detail: "One API for all three tools", secondDetail: "Manage keys for each app",
    action: "Explore API keys", href: "/api-keys", Art: DeveloperDoodle,
    label: "A doodle of a developer connecting voice tools to an app on her laptop",
  },
] as const;

export function CreativeUses() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const reduce = useReducedMotion();
  const active = USES[selected];
  const Art = active.Art;

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": case "ArrowDown": next = (index + 1) % USES.length; break;
      case "ArrowLeft": case "ArrowUp": next = (index + USES.length - 1) % USES.length; break;
      case "Home": next = 0; break;
      case "End": next = USES.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }

  return (
    <section id="ideas" aria-labelledby={`${id}-heading`} className="grid items-start gap-8 border-t border-line py-16 sm:gap-12 sm:py-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
      <div className="lg:pt-4">
        <p className="text-xs font-medium tracking-wide text-accent">A place for your next idea</p>
        <h2 id={`${id}-heading`} className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">What will you make?</h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-soft">
          A story to tell, a thought to save, or an app to build. Start with your words.
        </p>
        <div role="tablist" aria-label="Ways to use Bondeth" aria-orientation="vertical" className="mt-7 space-y-2">
          {USES.map((item, index) => (
            <button key={item.title} type="button" role="tab" id={`${id}-tab-${index}`}
              aria-selected={selected === index} aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1}
              ref={(node) => { tabs.current[index] = node; }}
              onClick={() => setSelected(index)} onKeyDown={(event) => navigate(event, index)}
              className={cx("group flex w-full items-center gap-4 rounded-xl border px-4 py-4 text-left transition-colors",
                selected === index ? "border-ink/30 bg-accent-soft/60" : "border-transparent hover:bg-surface-2")}>
              <span aria-hidden className={cx("grid size-8 shrink-0 place-items-center rounded-lg border text-xs tabular-nums",
                selected === index ? "border-ink/30 bg-accent text-accent-ink" : "border-line text-ink-soft")}>0{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{item.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-ink-soft">{item.hint}</span>
              </span>
              <ArrowRight aria-hidden className={cx("size-4 shrink-0 transition-transform", selected === index ? "text-ink" : "text-ink-faint group-hover:translate-x-1")} />
            </button>
          ))}
        </div>
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}
        className="paper-panel overflow-hidden bg-surface">
        <motion.div key={active.title} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          <div className="relative bg-accent-soft/25 px-5 pt-5">
            <span className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-soft">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />{active.audience}
            </span>
            <Art className="mx-auto h-56 w-full sm:h-64 lg:h-72" label={active.label} sizes="(max-width: 767px) 90vw, 540px" />
          </div>
          <div className="border-t border-line px-5 py-6 sm:px-7">
            <h3 className="max-w-md text-xl font-bold leading-snug tracking-tight">{active.heading}</h3>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">{active.description}</p>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-ink-soft">
              {[active.detail, active.secondDetail].map((detail) => <li key={detail} className="flex items-center gap-1.5"><Check aria-hidden className="size-3.5 text-accent" />{detail}</li>)}
            </ul>
            <Link href={active.href} className="mt-6 inline-flex items-center gap-2 border-b-2 border-accent pb-1 text-sm font-medium transition-colors hover:text-accent">
              {active.action}<ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
