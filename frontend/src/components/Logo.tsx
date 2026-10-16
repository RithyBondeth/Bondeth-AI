"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useId, useState } from "react";

import { cx } from "@/components/ui";

/**
 * Three strands of the voice wave, each with two shapes to ripple between. A strand's
 * shapes share the same path commands so they morph smoothly.
 */
const STRANDS = [
  { a: "M5 25 C10 17 14 33 19 25 S28 15 33 25 S40 31 44 23", b: "M5 24 C10 31 14 17 19 24 S28 33 33 23 S40 17 44 25", opacity: 0.35, width: 1.6, delay: 0.6 },
  { a: "M5 24 C10 30 14 18 19 24 S28 32 33 23 S40 18 44 25", b: "M5 25 C10 18 14 31 19 25 S28 16 33 25 S40 30 44 23", opacity: 0.55, width: 1.6, delay: 0.3 },
  { a: "M5 24.5 C10 19 14 30 19 24.5 S28 18 33 24.5 S40 28 44 24", b: "M5 24 C10 29 14 20 19 24 S28 30 33 23.5 S40 20 44 24.5", opacity: 1, width: 2.3, delay: 0 },
];

/**
 * The Bondeth AI mark: a glossy voice orb, saffron through pink to violet, with a layered
 * wave across it. The wave ripples twice when the mark appears and again each time
 * `replay` changes (on hover), then rests, so it never loops on every page.
 * src/app/icon.svg is a static copy.
 */
export function LogoMark({ className, replay = 0 }: { className?: string; replay?: number }) {
  const id = `logo${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden overflow="visible">
      <defs>
        <radialGradient id={`${id}-orb`} cx=".32" cy=".28" r=".85">
          <stop offset="0" stopColor="#ffd9b0" />
          <stop offset=".3" stopColor="#ff8a2b" />
          <stop offset=".62" stopColor="#e0559b" />
          <stop offset="1" stopColor="#5b3fd6" />
        </radialGradient>
        <radialGradient id={`${id}-halo`} cx=".5" cy=".55" r=".5">
          <stop offset=".6" stopColor="#e0559b" stopOpacity=".4" />
          <stop offset="1" stopColor="#7457ea" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}><circle cx="24" cy="24" r="17.5" /></clipPath>
      </defs>
      <circle cx="24" cy="25" r="23.5" fill={`url(#${id}-halo)`} />
      <circle cx="24" cy="24" r="17.5" fill={`url(#${id}-orb)`} />
      <g clipPath={`url(#${id}-clip)`} fill="none" stroke="#fff" strokeLinecap="round">
        {STRANDS.map((s) => (
          <motion.path key={`${s.a}-${replay}`} strokeOpacity={s.opacity} strokeWidth={s.width}
            initial={{ d: s.a }} animate={{ d: reduce ? s.a : [s.a, s.b, s.a] }}
            transition={{ duration: 1.6, delay: s.delay, repeat: 1, ease: "easeInOut" }} />
        ))}
      </g>
      <ellipse cx="19" cy="13.5" rx="8" ry="4.2" fill={`url(#${id}-shine)`} transform="rotate(-18 19 13.5)" />
      <circle cx="24" cy="24" r="17.5" fill="none" stroke="#fff" strokeOpacity={0.25} strokeWidth={1} />
    </svg>
  );
}

/**
 * The orb, "Bondeth" with a gradient AI badge, and the Khmer name បណ្ឌិត underneath.
 * `wordmarkClassName` lets the collapsed sidebar hide the lettering.
 */
export function Logo({ className, wordmarkClassName }: { className?: string; wordmarkClassName?: string }) {
  const [replay, setReplay] = useState(0);
  return (
    <Link href="/" className={cx("flex items-center gap-2", className)} aria-label="Bondeth AI home"
      onPointerEnter={() => setReplay((n) => n + 1)}>
      <LogoMark className="size-10 shrink-0" replay={replay} />
      <span className={cx("flex flex-col gap-1", wordmarkClassName)}>
        <span className="flex items-center gap-1.5 leading-none">
          <span className="text-xl font-bold leading-none tracking-tight">Bondeth</span>
          <span className="rounded-md bg-gradient-to-r from-[#ef7d22] via-[#d9569a] to-[#7457ea] px-1.5 py-0.5 text-[11px] font-bold leading-none text-white shadow-[0_4px_12px_-4px_#d9569a]">
            AI
          </span>
        </span>
        <span className="font-khmer text-xs font-medium leading-none text-ink-soft">បណ្ឌិត</span>
      </span>
    </Link>
  );
}
