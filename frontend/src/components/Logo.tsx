"use client";

import { useT } from "@/lib/useLocale";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { cx } from "@/components/ui";

/** An ink voice stamp with a loose highlighter fill. icon.svg is its static counterpart. */
export function LogoMark({ className, replay = 0 }: { className?: string; replay?: number }) {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <motion.g key={replay} animate={reduce ? undefined : { rotate: [0, -6, 3, 0] }}
        transition={{ duration: 0.45 }} style={{ transformOrigin: "24px 24px" }}>
        <path d="M13 5 C22 3 36 3 41 10 C45 17 45 34 39 40 C32 45 17 44 10 40 C3 35 3 19 7 11 Q9 7 13 5 Z"
          fill="#ffb544" stroke="#2c2923" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M11 15 L27 7 M8 23 L36 8 M8 32 L40 15 M12 39 L41 23 M23 42 L40 32"
          stroke="#fff7e3" strokeWidth="1.8" strokeLinecap="round" opacity=".65" />
        <path d="M13 23 V27 M19 18 V31 M25 13 V35 M31 19 V30 M37 23 V26"
          fill="none" stroke="#2c2923" strokeWidth="3" strokeLinecap="round" />
      </motion.g>
    </svg>
  );
}

export function Logo({ className, wordmarkClassName }: { className?: string; wordmarkClassName?: string }) {
  const t = useT();
  const [replay, setReplay] = useState(0);
  return (
    <Link href="/" className={cx("flex items-center gap-2.5", className)} aria-label={t("Bondeth AI home")}
      onPointerEnter={() => setReplay((n) => n + 1)}>
      <LogoMark className="size-10 shrink-0" replay={replay} />
      <span className={cx("flex flex-col gap-1", wordmarkClassName)}>
        <span className="flex items-center gap-1.5 leading-none">
          <span className="text-xl font-bold leading-none tracking-tight">Bondeth</span>
          <span className="rounded border border-ink bg-accent-soft px-1 py-0.5 font-sans text-xs font-bold leading-none text-ink">AI</span>
        </span>
        <span className="font-khmer text-xs font-medium leading-none text-ink-soft">បណ្ឌិត</span>
      </span>
    </Link>
  );
}
