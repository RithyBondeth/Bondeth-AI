"use client";

import { setLocale } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

export function LanguageSwitch() {
  const locale = useLocale();
  const next = locale === "en" ? "km" : "en";
  const label = next === "km" ? "Switch to Khmer / ប្ដូរទៅភាសាខ្មែរ" : "Switch to English / ប្ដូរទៅភាសាអង់គ្លេស";
  return <button type="button" onClick={() => setLocale(next)} aria-label={label} title={label}
    className="grid h-9 min-w-10 shrink-0 place-items-center rounded-xl px-2 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink">
    <span lang={next}>{next === "km" ? "ខ្មែរ" : "EN"}</span>
  </button>;
}
