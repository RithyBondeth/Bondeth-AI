"use client";

import { ArrowRight, AudioLines, Mic, Sparkles } from "lucide-react";
import { motion, useMotionValue, useSpring, useTransform, type Variants } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Aurora } from "@/components/Aurora";
import {
  CurlyArrowDoodle, HeadphonesDoodle, HeroScene, MicDoodle, SparkleDoodle, SquiggleUnderline, TwinVoicesDoodle,
} from "@/components/doodles";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cx } from "@/components/ui";
import { useHydrated, useUser } from "@/lib/hooks";

const stagger: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } };
const rise: Variants = {
  hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { type: "spring", stiffness: 160, damping: 22 } },
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Bondeth AI home">
      <span className="grid size-9 place-items-center rounded-xl bg-accent-soft"><MicDoodle className="h-7 w-6 text-ink" /></span>
      <span className="leading-tight">
        <span className="block font-bold tracking-tight">Bondeth AI</span>
        <span className="khmer block text-[11px] leading-none text-ink-soft">បណ្ឌិត</span>
      </span>
    </Link>
  );
}

export function MarketingFrame({ children }: { children: ReactNode }) {
  const user = useUser();
  const hydrated = useHydrated();
  return (
    <>
      <Aurora />
      <header className="sticky top-0 z-40 border-b border-line/60 bg-glass backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 text-sm text-ink-soft md:flex">
            <Link href="/stt" className="rounded-lg px-3 py-2 hover:text-ink">Speech to Text</Link>
            <Link href="/tts" className="rounded-lg px-3 py-2 hover:text-ink">Text to Speech</Link>
            <Link href="/clone" className="rounded-lg px-3 py-2 hover:text-ink">Voice Clone</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <span className={cx("flex items-center gap-2 transition-opacity", hydrated ? "opacity-100" : "opacity-0")}>
              {!user && <Link href="/login" className="hidden rounded-xl px-3 py-2 text-sm font-medium hover:bg-surface-2 sm:block">Sign in</Link>}
              <Link href="/stt" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink px-4 text-sm font-medium text-paper transition-transform hover:-translate-y-px">
                Open studio <ArrowRight className="size-4" />
              </Link>
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 sm:px-6">{children}</main>
      <footer className="mt-24 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-ink-soft sm:flex-row sm:items-center sm:px-6">
          <Logo />
          <p className="sm:ml-auto sm:max-w-md sm:text-right">
            Open-source Khmer &amp; English voice tools. Only clone voices you own or have permission to use.
          </p>
        </div>
      </footer>
    </>
  );
}

export function Hero() {
  return (
    <section className="grid items-center gap-12 pb-12 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
      <motion.div variants={stagger} initial="hidden" animate="visible">
        <motion.p variants={rise}
          className="khmer mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1 text-sm shadow-panel">
          <SparkleDoodle className="size-4" /> បណ្ឌិត AI · Khmer &amp; English voice studio
        </motion.p>
        <motion.h1 variants={rise} className="text-5xl font-bold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
          Speak Khmer.
          <br />
          <span className="relative inline-block">
            <span className="relative z-10 bg-gradient-to-r from-accent to-lilac bg-clip-text text-transparent">Be heard.</span>
            <SquiggleUnderline className="absolute -bottom-2 left-0 h-5 w-full" />
          </span>
        </motion.h1>
        <motion.p variants={rise} className="khmer mt-7 text-xl text-ink-soft">
          និយាយ ហើយឲ្យ AI សរសេរ អាន និងចម្លងសំឡេងជំនួសអ្នក។
        </motion.p>
        <motion.p variants={rise} className="mt-3 max-w-lg text-lg text-ink-soft">
          Transcribe speech, turn text into natural speech, and clone a voice from a short clip.
          Built for Khmer, fluent in English, free and open source.
        </motion.p>
        <motion.div variants={rise} className="mt-9 flex flex-wrap items-center gap-3">
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            <Link href="/stt"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 font-medium text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_12px_28px_-10px_var(--accent)]">
              Start talking <ArrowRight className="size-5" />
            </Link>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            <Link href="/tts" className="inline-flex h-12 items-center rounded-xl border border-line bg-surface px-6 font-medium shadow-panel">
              Try text to speech
            </Link>
          </motion.div>
          <CurlyArrowDoodle className="hidden h-12 w-16 -rotate-12 text-ink-faint sm:block" />
        </motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 90, damping: 18, delay: 0.15 }}>
        <HeroScene className="mx-auto w-full max-w-[520px] text-ink" />
      </motion.div>
    </section>
  );
}

/** A small, animated mock of the studio so visitors see what they'll get. */
export function StudioPreview() {
  return (
    <motion.section initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
      className="relative mx-auto my-10 overflow-hidden rounded-3xl border border-line bg-surface shadow-panel">
      <div className="flex h-10 items-center gap-1.5 border-b border-line px-4">
        {["bg-rose", "bg-accent", "bg-teal"].map((c) => <span key={c} className={`size-2.5 rounded-full ${c} opacity-70`} />)}
        <span className="mx-auto text-xs text-ink-faint">bondeth.ai/stt</span>
      </div>
      <div className="grid grid-cols-[150px_1fr] sm:grid-cols-[190px_1fr]">
        <div className="space-y-1 border-r border-line p-3 text-sm">
          {[["Speech to Text", Mic, true], ["Text to Speech", AudioLines, false], ["Voice Clone", Sparkles, false]].map(([label, Icon, on]) => {
            const I = Icon as typeof Mic;
            return (
              <div key={label as string} className={cx("flex items-center gap-2 rounded-lg px-2.5 py-2", on ? "bg-accent-soft text-ink" : "text-ink-soft")}>
                <I className={cx("size-4", on && "text-accent")} /> <span className="truncate">{label as string}</span>
              </div>
            );
          })}
        </div>
        <div className="dot-grid flex flex-col items-center gap-5 p-8">
          <div className="relative grid place-items-center">
            {[0, 1].map((r) => (
              <motion.span key={r} className="absolute inset-0 rounded-full border-2 border-accent"
                animate={{ scale: [1, 1.9], opacity: [0.5, 0] }} transition={{ duration: 2, repeat: Infinity, delay: r }} />
            ))}
            <span className="grid size-16 place-items-center rounded-full bg-accent text-white shadow-[0_14px_30px_-10px_var(--accent)]">
              <Mic className="size-7" />
            </span>
          </div>
          <div className="flex h-10 items-center gap-1">
            {Array.from({ length: 30 }, (_, i) => (
              <motion.span key={i} className="w-1 rounded-full bg-accent/70"
                animate={{ height: [6, 8 + ((i * 37) % 28), 6] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: (i % 10) * 0.08, ease: "easeInOut" }} />
            ))}
          </div>
          <p className="khmer w-full max-w-md rounded-xl border border-line bg-surface px-4 py-3 text-center">
            ខ្ញុំស្រលាញ់ភាសាខ្មែរ
            <motion.span className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 bg-accent" animate={{ opacity: [1, 0] }} transition={{ duration: 0.8, repeat: Infinity }} />
          </p>
        </div>
      </div>
    </motion.section>
  );
}

const FEATURES = [
  { href: "/stt", title: "Speech to Text", km: "សំឡេង → អក្សរ", glow: "var(--accent)",
    body: "Record or upload Khmer or English. Khmer comes back as clean, editable text.",
    doodle: <MicDoodle className="h-24 w-20 text-ink" /> },
  { href: "/tts", title: "Text to Speech", km: "អក្សរ → សំឡេង", glow: "var(--teal)",
    body: "Type in Khmer, English or both. Prices, dates and percentages are read in full.",
    doodle: <HeadphonesDoodle className="h-24 w-24 text-ink" /> },
  { href: "/clone", title: "Voice Clone", km: "ចម្លងសំឡេង", glow: "var(--lilac)",
    body: "Save a 3-30 second sample with consent, then make that voice say anything.",
    doodle: <TwinVoicesDoodle className="h-20 w-40 text-ink" /> },
];

export function Features() {
  return (
    <section className="py-16">
      <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-12 text-center">
        <p className="khmer text-sm font-medium text-accent">សំឡេងតែមួយ ឧបករណ៍បី</p>
        <h2 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Three tools, one studio</h2>
      </motion.div>
      <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }}
        className="grid gap-5 md:grid-cols-3">
        {FEATURES.map((f) => (
          <motion.div key={f.href} variants={rise}>
            <SpotlightCard href={f.href} glow={f.glow}>
              <div className="dot-grid flex h-36 items-center justify-center rounded-xl">{f.doodle}</div>
              <p className="khmer mt-5 text-sm text-ink-soft">{f.km}</p>
              <h3 className="text-xl font-bold">{f.title}</h3>
              <p className="mt-2 text-sm text-ink-soft">{f.body}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium">
                Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
            </SpotlightCard>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

/** A card with a soft coloured spotlight that follows the pointer and a gentle tilt. */
function SpotlightCard({ href, glow, children }: { href: string; glow: string; children: ReactNode }) {
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(y, [0, 1], [4, -4]), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useTransform(x, [0, 1], [-4, 4]), { stiffness: 200, damping: 20 });
  const background = useTransform([x, y], ([px, py]: number[]) =>
    `radial-gradient(320px circle at ${px * 100}% ${py * 100}%, color-mix(in oklab, ${glow} 14%, transparent), transparent 70%)`);

  return (
    <motion.div style={{ rotateX, rotateY, transformPerspective: 1000 }} whileHover={{ y: -4 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width);
        y.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => { x.set(0.5); y.set(0.5); }}
      className="relative h-full">
      <Link href={href} className="group relative block h-full overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-panel">
        <motion.span aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ background }} />
        <span className="relative block">{children}</span>
      </Link>
    </motion.div>
  );
}
