"use client";

import { Languages } from "lucide-react";

import { IconButton } from "@/components/ui";
import { setLocale } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

export function LanguageSwitch() {
  const locale = useLocale();
  const next = locale === "en" ? "km" : "en";
  const label = next === "km" ? "Switch to Khmer / ប្ដូរទៅភាសាខ្មែរ" : "Switch to English / ប្ដូរទៅភាសាអង់គ្លេស";
  return <IconButton label={label} onClick={() => setLocale(next)}>
    <Languages aria-hidden="true" className="size-[18px]" />
  </IconButton>;
}
