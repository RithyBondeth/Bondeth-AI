"use client";

import { useT } from "@/lib/useLocale";

import { ArrowRight, AudioLines, Check, Mic, Sparkles } from "lucide-react";
import { motion, useInView, useReducedMotion, type Variants } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Aurora } from "@/components/Aurora";
import { Logo, LogoMark } from "@/components/Logo";
import {
  CurlyArrowDoodle, HeroScene, IdeasDoodle, ListenerDoodle, SparkleDoodle, SpeakerDoodle, SquiggleUnderline, TwinVoicesDoodle,
} from "@/components/doodles";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cx } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { useHydrated, useUser } from "@/lib/hooks";

const stagger: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } };
const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 160, damping: 22 } },
};

export function MarketingFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const user = useUser();
  const hydrated = useHydrated();
  return (
    <>
      <Aurora />
      <a href="#main-content" className="skip-link ink-button">{t("Skip to content")}</a>
      <header className="marketing-header sticky top-0 z-40">
        <div className="mx-auto flex h-18 max-w-6xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
          <Logo wordmarkClassName="hidden min-[380px]:flex" />
          <nav className="hidden items-center gap-1 text-sm text-ink-soft lg:flex">
            <Link href="/stt" className="rounded-lg px-3 py-2 hover:text-ink">{t("Speech to Text")}</Link>
            <Link href="/tts" className="rounded-lg px-3 py-2 hover:text-ink">{t("Text to Speech")}</Link>
            <Link href="/clone" className="rounded-lg px-3 py-2 hover:text-ink">{t("Voice Clone")}</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitch /><ThemeToggle />
            <span className={cx("flex items-center gap-2 transition-opacity", hydrated ? "opacity-100" : "opacity-0")}>
              {!user && <Link href="/login" className="hidden rounded-xl px-3 py-2 text-sm font-medium hover:bg-surface-2 sm:block">{t("Sign in")}</Link>}
              <Link href="/stt" className="ink-button inline-flex h-9 items-center gap-1.5 whitespace-nowrap bg-ink px-3 text-sm font-medium text-paper transition-transform hover:-translate-y-px sm:px-4">
                <span className="sm:hidden">{t("Studio")}</span><span className="hidden sm:inline">{t("Open studio")}</span>
                <ArrowRight className="hidden size-4 shrink-0 sm:block" />
              </Link>
            </span>
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 sm:px-6">{children}</main>
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
  const t = useT();
  return (
    <footer className="mt-24 border-t-2 border-dashed border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs text-sm text-ink-soft">
            {t("Open-source Khmer & English voice tools. Only clone voices you own or have permission to use.")}</p>
        </div>
        {FOOTER_LINKS.map((col) => (
          <nav key={col.title} aria-label={t(col.title)}>
            <p className="text-sm font-bold">{t(col.title)} <span className="khmer font-normal text-ink-faint">· {col.km}</span></p>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external
                    ? <a href={l.href} target="_blank" rel="noreferrer" className="hover:text-ink">{t(l.label)} ↗</a>
                    : <Link href={l.href} className="hover:text-ink">{t(l.label)}</Link>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-5 text-xs text-ink-faint sm:px-6">
          <span>{t("© 2026 Bondeth AI. Free and open source under the MIT License.")}</span>
          <span className="khmer">{t("ធ្វើឡើងសម្រាប់ភាសាខ្មែរ · Made for Khmer")}</span>
        </p>
      </div>
    </footer>
  );
}

export function Hero() {
  const t = useT();
  return (
    <section className="grid items-center gap-8 pb-10 pt-12 sm:gap-12 sm:pt-16 lg:min-h-[600px] lg:grid-cols-[1fr_1.05fr] lg:gap-6 lg:pb-12 lg:pt-16">
      <motion.div variants={stagger} initial="hidden" animate="visible">
        <motion.p variants={rise}
          className="marker-label khmer mb-5 inline-flex items-center gap-2.5 text-xs font-medium">
          <SparkleDoodle className="size-4" /> {t(" បណ្ឌិត AI · Khmer & English voice studio")}</motion.p>
        <motion.h1 variants={rise} className="font-sans text-5xl font-bold leading-[1.08] tracking-[-0.04em] sm:text-6xl lg:text-[4.25rem]">
          {t("Speak Khmer.")}<br />
          <span className="relative inline-block">
            <span className="relative z-10 text-ink">{t("Be heard.")}</span>
            <SquiggleUnderline className="absolute -bottom-1 left-0 h-5 w-full" />
          </span>
        </motion.h1>
        <motion.p variants={rise} className="khmer mt-7 max-w-lg text-lg text-ink-soft">
          និយាយ ហើយឲ្យ AI សរសេរ អាន និងចម្លងសំឡេងជំនួសអ្នក។
        </motion.p>
        <motion.p variants={rise} className="mt-3 max-w-[28rem] text-base leading-relaxed text-ink-soft">
          {t("Transcribe speech, turn text into natural speech, and clone a voice from a short clip. Built for Khmer, fluent in English, free and open source.")}</motion.p>
        <motion.div variants={rise} className="mt-9 flex flex-wrap items-center gap-3">
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            <Link href="/stt"
              className="ink-button inline-flex h-12 items-center gap-2 bg-accent px-6 font-medium text-accent-ink transition-colors hover:brightness-105">
              {t("Start talking ")}<ArrowRight className="size-5" />
            </Link>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            <Link href="/tts" className="ink-button inline-flex h-12 items-center bg-surface px-6 font-medium">
              {t("Try text to speech")}</Link>
          </motion.div>
          <CurlyArrowDoodle className="hidden h-12 w-16 -rotate-12 text-ink sm:block" />
        </motion.div>
        <motion.ul variants={rise} className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-soft">
          {[t("Khmer & English"), t("No installation needed")].map((label) => <li key={label} className="flex items-center gap-1.5"><Check aria-hidden className="size-3.5 text-accent" />{t(label)}</li>)}
        </motion.ul>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 90, damping: 18, delay: 0.15 }}>
        <HeroScene className="mx-auto w-full max-w-[540px]" />
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
  const t = useT();
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
      aria-label={t("Interactive studio preview")} className="studio-preview paper-panel relative mx-auto mb-10 mt-6 overflow-hidden bg-surface">
      <div className="flex h-10 items-center gap-1.5 border-b border-line px-4">
        {[0, 1, 2].map((n) => <span key={n} className="size-2 rounded-full border border-ink/60 bg-accent/60" />)}
        <span className="mx-auto text-xs text-ink-soft">{t("A peek inside your studio /")} {tool}</span>
      </div>
      <div className="grid grid-cols-[60px_1fr] sm:grid-cols-[200px_1fr]">
        <div className="flex flex-col gap-4 border-r border-line p-2 sm:p-3">
          <span className="flex items-center justify-center gap-1.5 px-1 sm:justify-start">
            <LogoMark className="size-7 shrink-0" />
            <span className="hidden text-sm font-bold tracking-tight sm:inline">Bondeth</span>
          </span>
          <div className="space-y-1 text-sm" role="tablist" aria-label={t("Studio tools")}>
            {TOOLS.map(({ id, label, Icon }) => {
              const on = id === tool;
              return (
                <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTool(id)}
                  aria-label={t(label)} className={cx("relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-2.5 py-2 text-left sm:justify-start",
                    on ? "text-ink" : "text-ink-soft hover:bg-surface-2")}>
                  {on && <motion.span layoutId="preview-tab" className="absolute inset-0 rounded-lg bg-accent-soft" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                  <Icon className={cx("relative size-4 shrink-0", on && "text-accent")} />
                  <span className="relative hidden truncate sm:inline">{t(label)}</span>
                  {on && touring && (
                    <motion.span key={tool} className="absolute bottom-0 left-0 h-0.5 bg-accent/60"
                      initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: CYCLE_MS / 1000, ease: "linear" }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="relative grid min-h-72 min-w-0 place-items-center p-4 sm:p-8">
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
        <span className="ink-button grid size-16 place-items-center bg-accent text-accent-ink">
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
  const t = useT();
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
        <p className="mt-1 text-sm text-ink-soft">{t("Hello! The price is 12,500 riel.")}</p>
      </div>
      <div className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
          <AudioLines className="size-4" />
        </span>
        <Bars count={26} live={live} progress={progress} />
      </div>
    </>
  );
}

function CloneMock({ live }: { live: boolean }) {
  const t = useT();
  return (
    <>
      <div className="flex w-full flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2.5 pr-4">
          <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-bold text-ink">S</span>
          <span className="text-left text-sm"><span className="block font-medium">Sokha</span><span className="text-xs text-ink-faint">{t("12 s sample")}</span></span>
        </div>
        <ArrowRight className="size-5 shrink-0 rotate-90 text-ink-faint sm:rotate-0" />
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-ink bg-surface p-2.5 pr-4">
          <span className="grid size-9 place-items-center rounded-full border border-dashed border-ink text-sm font-bold text-ink">S</span>
          <span className="text-left text-sm"><span className="block font-medium">{t("Clone")}</span><span className="text-xs text-ink-faint">{t("Any text")}</span></span>
        </div>
      </div>
      <Bars count={28} live={live} color="bg-accent/80" />
      <p className="khmer w-full rounded-xl border border-line bg-surface px-4 py-3 text-center">
        អរុណសួស្តី! នេះជាសំឡេងរបស់ខ្ញុំ<Caret live={live} />
      </p>
    </>
  );
}

const FEATURES = [
  { href: "/stt", title: "Speech to Text", km: "សំឡេង → អក្សរ",
    body: "Record or upload Khmer or English. Khmer comes back as clean, editable text.",
    doodle: <SpeakerDoodle className="h-48 w-full" label="A Cambodian woman speaking into a studio microphone" /> },
  { href: "/tts", title: "Text to Speech", km: "អក្សរ → សំឡេង",
    body: "Type in Khmer, English or both. Prices, dates and percentages are read in full.",
    doodle: <ListenerDoodle className="h-48 w-full" label="A Cambodian man listening with headphones" /> },
  { href: "/clone", title: "Voice Clone", km: "ចម្លងសំឡេង",
    body: "Save a 3-30 second sample with consent, then make that voice say anything.",
    doodle: <TwinVoicesDoodle className="h-48 w-full" label="A speaker and her dashed-outline voice clone with a hand-drawn audio waveform" /> },
];

export function Features() {
  const t = useT();
  return (
    <section id="tools" className="pb-16 pt-16 sm:pb-20">
      <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-9 max-w-xl">
        <p className="khmer text-sm font-medium text-accent">សំឡេងតែមួយ ឧបករណ៍បី</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{t("Three tools, one studio")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{t("From your first word to the final recording. Find the right tool for what you want to make.")}</p>
      </motion.div>
      <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }}
        className="grid gap-8 md:grid-cols-3">
        {FEATURES.map((f, index) => (
          <motion.div key={f.href} variants={rise} className="feature-paper paper-panel">
            <PaperCard href={f.href}>
              <div className="flex h-52 items-center justify-center overflow-hidden border-b border-dashed border-line p-2">
                <motion.div className="w-full" whileHover={{ scale: 1.04 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
                  {f.doodle}
                </motion.div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-2">
                <p className="khmer text-xs text-ink-soft">{f.km}</p>
                <span className="text-xs tabular-nums text-ink-soft" aria-hidden>0{index + 1}</span>
              </div>
              <h3 className="mt-2 text-xl font-bold tracking-tight">{t(f.title)}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">{t(f.body)}</p>
              <span className="mt-6 inline-flex items-center gap-2 border-t border-line pt-4 text-xs font-medium">
                {t("Open ")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
            </PaperCard>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

/** Paper sheets keep the illustration, copy, and action together. */
function PaperCard({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="group flex h-full flex-col rounded-2xl p-5 transition-colors hover:bg-accent-soft/20">
    {children}
  </Link>;
}

/** Closing call to action, so the page ends on something to do. */
export function ClosingCta() {
  const t = useT();
  return (
    <motion.section initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
      className="paper-panel relative overflow-hidden bg-accent-soft/40 p-7 sm:p-12">
      <div className="grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="khmer text-sm font-medium text-accent">សំឡេងរបស់អ្នក ជាភាសារបស់អ្នក</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{t("Your voice, in your language.")}</h2>
          <p className="mt-3 max-w-md text-ink-soft">
            {t("No install, no credit card. Open the studio and say something in Khmer — the text appears as you talk.")}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
              <Link href="/stt"
                className="ink-button inline-flex h-12 items-center gap-2 bg-accent px-6 font-medium text-accent-ink transition-colors hover:brightness-105">
                {t("Start talking ")}<ArrowRight className="size-5" />
              </Link>
            </motion.div>
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
              <Link href="/register" className="ink-button inline-flex h-12 items-center bg-surface px-6 font-medium hover:bg-surface-2">
                {t("Create a free account")}</Link>
            </motion.div>
          </div>
        </div>
        <IdeasDoodle className="mx-auto w-full max-w-sm" label={t("A doodle of someone turning a spoken idea into notes")} />
      </div>
    </motion.section>
  );
}
