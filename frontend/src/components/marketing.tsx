"use client";

import { ArrowRight, AudioLines, Mic, Sparkles } from "lucide-react";
import { motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform, type Variants } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Aurora } from "@/components/Aurora";
import { Logo, LogoMark } from "@/components/Logo";
import {
  CurlyArrowDoodle, HeroScene, ListenerDoodle, SparkleDoodle, SpeakerDoodle, SquiggleUnderline, TwinVoicesDoodle,
} from "@/components/doodles";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cx } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { useHydrated, useUser } from "@/lib/hooks";

const stagger: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } };
const rise: Variants = {
  hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { type: "spring", stiffness: 160, damping: 22 } },
};

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
      <Footer />
    </>
  );
}

const GITHUB = "https://github.com/RithyBondeth/Bondeth-AI";

const FOOTER_LINKS: { title: string; km: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  { title: "Studio", km: "ស្ទូឌីយោ", links: [
    { label: "Speech to Text", href: "/stt" },
    { label: "Text to Speech", href: "/tts" },
    { label: "Voice Clone", href: "/clone" },
  ] },
  { title: "Developers", km: "អ្នកអភិវឌ្ឍ", links: [
    { label: "API docs", href: `${API_URL}/docs`, external: true },
    { label: "API keys", href: "/api-keys" },
    { label: "GitHub", href: GITHUB, external: true },
  ] },
  { title: "Trust", km: "ទំនុកចិត្ត", links: [
    { label: "Voice consent policy", href: "/voice-consent" },
    { label: "MIT License", href: `${GITHUB}/blob/main/LICENSE`, external: true },
  ] },
];

function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs text-sm text-ink-soft">
            Open-source Khmer &amp; English voice tools. Only clone voices you own or have permission to use.
          </p>
        </div>
        {FOOTER_LINKS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <p className="text-sm font-bold">{col.title} <span className="khmer font-normal text-ink-faint">· {col.km}</span></p>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external
                    ? <a href={l.href} target="_blank" rel="noreferrer" className="hover:text-ink">{l.label} ↗</a>
                    : <Link href={l.href} className="hover:text-ink">{l.label}</Link>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-5 text-xs text-ink-faint sm:px-6">
          <span>© 2026 Bondeth AI. Free and open source under the MIT License.</span>
          <span className="khmer">ធ្វើឡើងសម្រាប់ភាសាខ្មែរ · Made for Khmer</span>
        </p>
      </div>
    </footer>
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

const TOOLS = [
  { id: "stt", label: "Speech to Text", Icon: Mic },
  { id: "tts", label: "Text to Speech", Icon: AudioLines },
  { id: "clone", label: "Voice Clone", Icon: Sparkles },
] as const;
type ToolId = (typeof TOOLS)[number]["id"];

const CYCLE_MS = 4500;

/** A small mock of the studio that tours the three tools, so visitors see what they'll get. */
export function StudioPreview() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const reduce = useReducedMotion();
  const [tool, setTool] = useState<ToolId>("stt");
  const [hovered, setHovered] = useState(false);
  // Loops and the tour run only while the mock is on screen and not hovered, never with reduced motion.
  const live = inView && !reduce;
  const touring = live && !hovered;

  useEffect(() => {
    if (!touring) return;
    const t = setTimeout(() => {
      setTool((cur) => TOOLS[(TOOLS.findIndex((x) => x.id === cur) + 1) % TOOLS.length].id);
    }, CYCLE_MS);
    return () => clearTimeout(t);
  }, [touring, tool]);

  return (
    <motion.section ref={ref} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      className="relative mx-auto my-10 overflow-hidden rounded-3xl border border-line bg-surface shadow-panel">
      <div className="flex h-10 items-center gap-1.5 border-b border-line px-4">
        {["bg-rose", "bg-accent", "bg-teal"].map((c) => <span key={c} className={`size-2.5 rounded-full ${c} opacity-70`} />)}
        <span className="mx-auto rounded-md bg-surface-2 px-3 py-0.5 text-xs text-ink-faint">bondeth.ai/{tool}</span>
      </div>
      <div className="grid grid-cols-[60px_1fr] sm:grid-cols-[200px_1fr]">
        <div className="flex flex-col gap-4 border-r border-line p-2 sm:p-3">
          <span className="flex items-center justify-center gap-1.5 px-1 sm:justify-start">
            <LogoMark className="size-7 shrink-0" />
            <span className="hidden text-sm font-bold tracking-tight sm:inline">Bondeth</span>
          </span>
          <div className="space-y-1 text-sm" role="tablist" aria-label="Studio tools">
            {TOOLS.map(({ id, label, Icon }) => {
              const on = id === tool;
              return (
                <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTool(id)}
                  aria-label={label} className={cx("relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-2.5 py-2 text-left sm:justify-start",
                    on ? "text-ink" : "text-ink-soft hover:bg-surface-2")}>
                  {on && <motion.span layoutId="preview-tab" className="absolute inset-0 rounded-lg bg-accent-soft" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                  <Icon className={cx("relative size-4 shrink-0", on && "text-accent")} />
                  <span className="relative hidden truncate sm:inline">{label}</span>
                  {on && touring && (
                    <motion.span key={tool} className="absolute bottom-0 left-0 h-0.5 bg-accent/60"
                      initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: CYCLE_MS / 1000, ease: "linear" }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="dot-grid relative grid min-h-72 min-w-0 place-items-center p-4 sm:p-8">
          {/* Keyed so each tool fades in fresh; no exit wait, so switching is instant. */}
          <motion.div key={tool} className="flex w-full min-w-0 max-w-md flex-col items-center gap-5"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            {tool === "stt" && <SttMock live={live} />}
            {tool === "tts" && <TtsMock live={live} />}
            {tool === "clone" && <CloneMock live={live} />}
          </motion.div>
        </div>
      </div>
    </motion.section>
  );
}

/** A row of waveform bars; they dance while `live`, and fill left to right with `progress` (0-1). */
function Bars({ count = 30, live, color = "bg-accent/70", progress }: { count?: number; live: boolean; color?: string; progress?: number }) {
  return (
    <div className="flex h-10 max-w-full items-center justify-center gap-1 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        const peak = 8 + ((i * 37) % 28);
        const rest = 6 + ((i * 37) % 28) / 2;
        const played = progress !== undefined && i / count < progress;
        return (
          <motion.span key={i} className={cx("w-1 shrink-0 rounded-full", progress === undefined ? color : played ? "bg-accent" : "bg-line")}
            initial={{ height: rest }}
            animate={live && progress === undefined ? { height: [6, peak, 6] } : { height: rest }}
            transition={live && progress === undefined ? { duration: 1.2, repeat: Infinity, delay: (i % 10) * 0.08, ease: "easeInOut" } : { duration: 0.4 }} />
        );
      })}
    </div>
  );
}

function Caret({ live }: { live: boolean }) {
  return (
    <motion.span className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 bg-accent"
      animate={live ? { opacity: [1, 0] } : { opacity: 1 }} transition={live ? { duration: 0.8, repeat: Infinity } : { duration: 0 }} />
  );
}

function SttMock({ live }: { live: boolean }) {
  return (
    <>
      <div className="relative grid place-items-center">
        {live && [0, 1].map((r) => (
          <motion.span key={r} className="absolute inset-0 rounded-full border-2 border-accent"
            initial={{ scale: 1, opacity: 0 }} animate={{ scale: [1, 1.9], opacity: [0.5, 0] }} transition={{ duration: 2, repeat: Infinity, delay: r }} />
        ))}
        <span className="grid size-16 place-items-center rounded-full bg-accent text-white shadow-[0_14px_30px_-10px_var(--accent)]">
          <Mic className="size-7" />
        </span>
      </div>
      <Bars live={live} />
      <p className="khmer w-full rounded-xl border border-line bg-surface px-4 py-3 text-center">
        ខ្ញុំស្រលាញ់ភាសាខ្មែរ<Caret live={live} />
      </p>
    </>
  );
}

function TtsMock({ live }: { live: boolean }) {
  // The "playback" sweeps across the waveform while the mock is live.
  const [progress, setProgress] = useState(0.35);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setProgress((p) => (p >= 1 ? 0 : p + 0.02)), 80);
    return () => clearInterval(t);
  }, [live]);
  return (
    <>
      <div className="w-full rounded-xl border border-line bg-surface p-4 text-left">
        <p className="khmer">សួស្តី! តម្លៃ ១២៥០០ រៀល</p>
        <p className="mt-1 text-sm text-ink-soft">Hello! The price is 12,500 riel.</p>
      </div>
      <div className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal text-white">
          <AudioLines className="size-4" />
        </span>
        <Bars count={26} live={live} progress={progress} />
      </div>
    </>
  );
}

function CloneMock({ live }: { live: boolean }) {
  return (
    <>
      <div className="flex w-full flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2.5 pr-4">
          <span className="grid size-9 place-items-center rounded-full bg-lilac-soft text-sm font-bold text-lilac">S</span>
          <span className="text-left text-sm"><span className="block font-medium">Sokha</span><span className="text-xs text-ink-faint">12 s sample</span></span>
        </div>
        <ArrowRight className="size-5 shrink-0 rotate-90 text-ink-faint sm:rotate-0" />
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-lilac bg-surface p-2.5 pr-4">
          <span className="grid size-9 place-items-center rounded-full border border-dashed border-lilac text-sm font-bold text-lilac">S</span>
          <span className="text-left text-sm"><span className="block font-medium">Clone</span><span className="text-xs text-ink-faint">Any text</span></span>
        </div>
      </div>
      <Bars count={28} live={live} color="bg-lilac/70" />
      <p className="khmer w-full rounded-xl border border-line bg-surface px-4 py-3 text-center">
        អរុណសួស្តី! នេះជាសំឡេងរបស់ខ្ញុំ<Caret live={live} />
      </p>
    </>
  );
}

const FEATURES = [
  { href: "/stt", title: "Speech to Text", km: "សំឡេង → អក្សរ", glow: "var(--accent)", tint: "bg-accent-soft/60",
    body: "Record or upload Khmer or English. Khmer comes back as clean, editable text.",
    doodle: <SpeakerDoodle className="h-40 w-full text-ink" label="Doodle of a woman talking into a microphone, her words landing on a card" /> },
  { href: "/tts", title: "Text to Speech", km: "អក្សរ → សំឡេង", glow: "var(--teal)", tint: "bg-teal-soft/60",
    body: "Type in Khmer, English or both. Prices, dates and percentages are read in full.",
    doodle: <ListenerDoodle className="h-40 w-full text-ink" label="Doodle of someone sitting cross-legged, listening on headphones" /> },
  { href: "/clone", title: "Voice Clone", km: "ចម្លងសំឡេង", glow: "var(--lilac)", tint: "bg-lilac-soft/60",
    body: "Save a 3-30 second sample with consent, then make that voice say anything.",
    doodle: <TwinVoicesDoodle className="h-40 w-full text-ink" label="Doodle of a person waving at their dashed voice clone" /> },
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
              <div className={cx("flex h-48 items-center justify-center overflow-hidden rounded-xl p-3", f.tint)}>
                <motion.div className="w-full" whileHover={{ scale: 1.04 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
                  {f.doodle}
                </motion.div>
              </div>
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

/** Closing call to action, so the page ends on something to do. */
export function ClosingCta() {
  return (
    <motion.section initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
      className="relative overflow-hidden rounded-3xl border border-line bg-surface p-8 shadow-panel sm:p-12">
      <div className="grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="khmer text-sm font-medium text-accent">សំឡេងរបស់អ្នក ជាភាសារបស់អ្នក</p>
          <h2 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Your voice, in your language.</h2>
          <p className="mt-3 max-w-md text-ink-soft">
            No install, no credit card. Open the studio and say something in Khmer — the text appears as you talk.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
              <Link href="/stt"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 font-medium text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_12px_28px_-10px_var(--accent)]">
                Start talking <ArrowRight className="size-5" />
              </Link>
            </motion.div>
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
              <Link href="/register" className="inline-flex h-12 items-center rounded-xl border border-line bg-surface px-6 font-medium hover:bg-surface-2">
                Create a free account
              </Link>
            </motion.div>
          </div>
        </div>
        <TwinVoicesDoodle className="mx-auto w-full max-w-sm text-ink" label="Doodle of a person waving at their dashed voice clone" />
      </div>
    </motion.section>
  );
}
