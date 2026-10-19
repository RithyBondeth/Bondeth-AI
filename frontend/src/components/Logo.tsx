"use client";

import { useT } from "@/lib/useLocale";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { cx } from "@/components/ui";

/** The approved Bubble B artwork, traced to SVG so its ink and scribbles stay crisp. */
export function LogoMark({ className, replay = 0 }: { className?: string; replay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.span key={replay} aria-hidden="true"
      className={cx("relative inline-block align-middle", className)}
      animate={reduce ? undefined : { rotate: [0, -6, 3, 0] }}
      transition={{ duration: 0.45 }}>
      <Image src="/brand/mark.svg" alt="" fill unoptimized loading="eager" className="object-contain dark:hidden" />
      <Image src="/brand/mark-dark.svg" alt="" fill unoptimized loading="eager" className="hidden object-contain dark:block" />
    </motion.span>
  );
}

/** Original lettering and marker underline; shared by the full and compact lockups. */
export function LogoWordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span aria-hidden="true" className={cx("relative inline-block shrink-0", compact ? "h-6 w-24" : "h-8 w-32", className)}>
      <Image src="/brand/wordmark.svg" alt="" fill unoptimized loading="eager" className="object-contain dark:hidden" />
      <Image src="/brand/wordmark-dark.svg" alt="" fill unoptimized loading="eager" className="hidden object-contain dark:block" />
    </span>
  );
}

export function Logo({ className, wordmarkClassName }: { className?: string; wordmarkClassName?: string }) {
  const t = useT();
  const [replay, setReplay] = useState(0);
  return (
    <Link href="/" className={cx("flex shrink-0 items-center gap-2.5", className)} aria-label={t("Bondeth AI home")}
      onPointerEnter={() => setReplay((n) => n + 1)}>
      <LogoMark className="size-10 shrink-0" replay={replay} />
      <span className={cx("flex items-center", wordmarkClassName)}>
        <LogoWordmark />
      </span>
    </Link>
  );
}
