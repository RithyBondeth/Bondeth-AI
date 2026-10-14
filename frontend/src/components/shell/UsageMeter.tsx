"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui";
import { useUsage } from "@/lib/hooks";
import type { QuotaName } from "@/lib/types";

const ROWS: { name: QuotaName; label: string; format: (n: number) => string; unit: string }[] = [
  { name: "stt_seconds", label: "Transcription", format: (s) => String(Math.ceil(s / 60)), unit: "min" },
  { name: "tts_chars", label: "Speech", format: (c) => c.toLocaleString(), unit: "chars" },
  { name: "clone_jobs", label: "Clones", format: String, unit: "" },
];

/** Today's allowances in the sidebar. Hidden when the server has limits switched off. */
export function UsageMeter({ className }: { className?: string }) {
  const usage = useUsage();
  const pathname = usePathname();
  const rows = ROWS.flatMap((row) => {
    const q = usage?.quotas[row.name];
    return q && q.limit !== null ? [{ ...row, used: q.used, limit: q.limit }] : [];
  });
  if (!usage || rows.length === 0) return null;

  return (
    <div className={cx("rounded-2xl border border-line bg-surface p-4", className)}>
      <p className="flex items-baseline justify-between text-sm font-medium">
        Today&apos;s allowance <span className="khmer text-[11px] font-normal text-ink-faint">ថ្ងៃនេះ</span>
      </p>
      <ul className="mt-3 space-y-2.5">
        {rows.map(({ name, label, format, unit, used, limit }) => {
          const share = limit > 0 ? Math.min(used / limit, 1) : 1;
          return (
            <li key={name}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-ink-soft">{label}</span>
                <span className="tabular-nums">
                  <span className={cx(share >= 0.9 && "font-medium text-rose")}>{format(used)}</span>
                  <span className="text-ink-faint"> / {format(limit)}{unit && ` ${unit}`}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"
                role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}>
                <motion.div className={cx("h-full rounded-full", share >= 0.9 ? "bg-rose" : "bg-accent")}
                  initial={false} animate={{ width: `${share * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-snug text-ink-faint">
        Resets at {new Date(usage.resets_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
        {usage.account === "unverified" ? (
          <>
            {" "}
            <Link href="/account" className="font-medium text-accent hover:underline">Confirm your email</Link> for more.
          </>
        ) : !usage.signed_in && (
          <>
            {" "}
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="font-medium text-accent hover:underline">
              Sign in
            </Link>{" "}
            for more.
          </>
        )}
      </p>
    </div>
  );
}
