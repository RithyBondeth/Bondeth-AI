"use client";

import { useT } from "@/lib/useLocale";

import { ArrowRight, AudioLines, Check, Code2, Mic, Sparkles } from "lucide-react";
import { motion, useInView, useReducedMotion, type Variants } from "motion/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Aurora } from "@/components/Aurora";
import { Logo, LogoMark, LogoWordmark } from "@/components/Logo";
import {
  IdeasDoodle, ListenerDoodle, SpeakerDoodle, TwinVoicesDoodle,
} from "@/components/doodles";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cx } from "@/components/ui";
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
    { label: "API docs", href: "/api" },
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
    <footer className="mt-24 border-t border-line bg-surface/60">
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
    <>
    <section className="grid items-center gap-10 pb-10 pt-10 sm:gap-12 sm:pt-14 lg:min-h-[570px] lg:grid-cols-[1fr_1fr] lg:gap-12 lg:pb-12 lg:pt-12">
      <motion.div variants={stagger} initial="hidden" animate="visible">
        <motion.p variants={rise}
          className="marker-label khmer mb-6 inline-flex max-w-full items-center gap-2 text-[11px] font-medium sm:text-xs">
          <AudioLines aria-hidden className="size-4 shrink-0 text-accent" /> {t(" បណ្ឌិត AI · Khmer & English voice studio")}</motion.p>
        <motion.h1 variants={rise} className="font-sans text-[2.85rem] font-bold leading-[1.06] tracking-[-0.055em] sm:text-6xl lg:text-[4.5rem]">
          {t("Speak Khmer.")}<br />
          <span className="text-accent">{t("Be heard.")}</span>
        </motion.h1>
        <motion.p variants={rise} className="secondary-khmer khmer mt-6 max-w-lg text-base text-ink-soft">
          និយាយ ហើយឲ្យ AI សរសេរ អាន និងចម្លងសំឡេងជំនួសអ្នក។
        </motion.p>
        <motion.p variants={rise} className="mt-3 max-w-[28rem] text-[15px] leading-[1.8] text-ink-soft">
          {t("Transcribe speech, turn text into natural speech, and clone a voice from a short clip. Built for Khmer, fluent in English, free and open source.")}</motion.p>
        <motion.div variants={rise} className="mt-7 flex flex-wrap items-center gap-3">
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
        </motion.div>
      </motion.div>

      <HeroShowcase />
    </section>
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-y border-line py-5 text-xs text-ink-soft sm:justify-between sm:gap-x-4">
      <span className="flex items-center gap-2"><AudioLines aria-hidden className="size-4 text-accent" />{t("Khmer & English")}</span>
      <span className="flex items-center gap-2"><Check aria-hidden className="size-4 text-accent" />{t("No installation needed")}</span>
      <a href={GITHUB} target="_blank" rel="noreferrer" className="flex items-center gap-2 transition-colors hover:text-ink"><Code2 aria-hidden className="size-4 text-accent" />{t("Free and open source")}</a>
    </div>
    </>
  );
}

const TOOLS = [
  { id: "stt", label: "Speech to Text", Icon: Mic, Art: SpeakerDoodle,
    description: "Record or upload Khmer or English. Khmer comes back as clean, editable text.",
    artLabel: "A Cambodian woman speaking into a studio microphone" },
  { id: "tts", label: "Text to Speech", Icon: AudioLines, Art: ListenerDoodle,
    description: "Type in Khmer, English or both. Prices, dates and percentages are read in full.",
    artLabel: "A Cambodian man listening with headphones" },
  { id: "clone", label: "Voice Clone", Icon: Sparkles, Art: TwinVoicesDoodle,
    description: "Save a 3-30 second sample with consent, then make that voice say anything.",
    artLabel: "A speaker and her dashed-outline voice clone with a hand-drawn audio waveform" },
] as const;
type ToolId = (typeof TOOLS)[number]["id"];

function HeroShowcase() {
  const t = useT();
  const id = useId();
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduce = useReducedMotion();
  const active = TOOLS[selected];
  const { Art, Icon } = active;

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % TOOLS.length; break;
      case "ArrowLeft": next = (index + TOOLS.length - 1) % TOOLS.length; break;
      case "Home": next = 0; break;
      case "End": next = TOOLS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }

  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 22, delay: 0.15 }} className="hero-showcase min-w-0">
      <div role="tablist" aria-label={t("Explore voice tools")} className="hero-tool-tabs grid grid-cols-3 gap-1 p-1.5">
        {TOOLS.map(({ id: toolId, label, Icon: ToolIcon }, index) => (
          <button key={toolId} type="button" role="tab" id={`${id}-${toolId}`} aria-selected={selected === index}
            aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1}
            ref={(node) => { tabs.current[index] = node; }}
            onClick={() => setSelected(index)} onKeyDown={(event) => navigate(event, index)}
            className={cx("flex min-w-0 flex-col items-center justify-center gap-2 rounded-xl px-1 py-3 text-center text-[11px] font-medium transition-colors sm:text-xs",
              selected === index ? "bg-accent-soft text-ink" : "text-ink-soft hover:bg-surface-2")}>
            <ToolIcon aria-hidden className={cx("size-[18px]", selected === index && "text-accent")} />
            {t(label)}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${active.id}`} tabIndex={0} className="rounded-2xl">
        <div className="hero-stage">
          <motion.div key={active.id} initial={reduce ? false : { opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22 }} className="relative w-full">
            <Art className="h-64 w-full sm:h-72 lg:h-80" label={t(active.artLabel)} preload={selected === 0} />
          </motion.div>
        </div>
        <div className="hero-tool-detail flex min-h-32 items-center gap-4 rounded-[20px] border border-line bg-surface p-5 shadow-panel">
          <span aria-hidden className="hidden size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent min-[380px]:grid"><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight">{t(active.label)}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{t(active.description)}</p>
          </div>
          <Link href={`/${active.id}`} aria-label={`${t("Open ")}${t(active.label)}`}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-transform hover:translate-x-0.5">
            <ArrowRight aria-hidden className="size-5" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

const CYCLE_MS = 4500;

/** A small mock of the studio that tours the three tools, so visitors see what they'll get. */
export function StudioPreview() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const reduce = useReducedMotion();
  const [tool, setTool] = useState<ToolId>("stt");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Loops and the tour run only while the mock is on screen and not hovered, never with reduced motion.
  const live = inView && !reduce;
  const touring = live && !hovered && !focused;

  useEffect(() => {
    if (!touring) return;
    const t = setTimeout(() => {
      setTool((cur) => TOOLS[(TOOLS.findIndex((x) => x.id === cur) + 1) % TOOLS.length].id);
    }, CYCLE_MS);
    return () => clearTimeout(t);
  }, [touring, tool]);

  return (
    <motion.section ref={ref} initial={false}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      aria-label={t("Interactive studio preview")} className="studio-preview paper-panel relative mx-auto mb-8 mt-12 overflow-hidden bg-surface sm:mt-16">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line bg-surface-2/40 px-4 py-3 sm:px-5">
        <span className="flex items-center gap-2 text-xs font-medium text-ink-soft"><AudioLines aria-hidden className="size-4 text-accent" />{t("A peek inside your studio /")} {tool}</span>
        <Link href={`/${tool}`} className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink hover:text-accent">{t("Open ")}<ArrowRight aria-hidden className="size-3.5" /></Link>
      </div>
      <div className="grid grid-cols-[60px_1fr] sm:grid-cols-[200px_1fr]">
        <div className="flex flex-col gap-4 border-r border-line bg-paper/70 p-2 sm:p-4">
          <span className="flex items-center justify-center gap-1.5 px-1 sm:justify-start">
            <LogoMark className="size-7 shrink-0" />
            <LogoWordmark compact className="hidden sm:inline-block" />
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
        <div className="relative grid min-h-72 min-w-0 place-items-center bg-accent-soft/10 p-4 sm:min-h-80 sm:p-8">
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
    doodle: <SpeakerDoodle className="h-52 w-full md:h-64" label="A Cambodian woman speaking into a studio microphone" /> },
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
    <section id="tools" className="pb-16 pt-14 sm:pb-20 sm:pt-20">
      <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-9 max-w-xl">
        <h2 className="text-3xl font-bold tracking-[-0.04em] sm:text-[2.6rem]">{t("Three tools, one studio")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{t("From your first word to the final recording. Find the right tool for what you want to make.")}</p>
      </motion.div>
      <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }}
        className="grid gap-5 md:grid-cols-2">
        {FEATURES.map((f, index) => (
          <motion.div key={f.href} variants={rise} className={cx("feature-paper paper-panel overflow-hidden", index === 0 && "md:row-span-2")}>
            <PaperCard href={f.href} featured={index === 0}>
              <div className={cx("feature-art flex items-center justify-center overflow-hidden p-3", index === 0 ? "h-52 md:min-h-72 md:flex-1" : "h-44 md:h-full")}>
                <motion.div className="w-full" whileHover={{ scale: 1.04 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
                  {f.doodle}
                </motion.div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col p-6">
                <p className="khmer text-xs text-ink-soft">{f.km}</p>
                <h3 className={cx("mt-2 font-bold tracking-tight", index === 0 ? "text-2xl" : "text-xl")}>{t(f.title)}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">{t(f.body)}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-accent">
                  {t("Open ")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </PaperCard>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

/** Paper sheets keep the illustration, copy, and action together. */
function PaperCard({ href, children, featured }: { href: string; children: ReactNode; featured: boolean }) {
  return <Link href={href} className={cx("group grid h-full rounded-[20px] transition-colors hover:bg-accent-soft/20", featured ? "grid-cols-1" : "grid-cols-1 md:grid-cols-[0.8fr_1fr]")}>
    {children}
  </Link>;
}

/** Closing call to action, so the page ends on something to do. */
export function ClosingCta() {
  const t = useT();
  return (
    <motion.section initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
      className="paper-panel relative overflow-hidden bg-accent-soft/60 p-7 sm:p-12">
      <div className="grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
        <div>
          <h2 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{t("Your voice, in your language.")}</h2>
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
