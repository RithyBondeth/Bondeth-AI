"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useT } from "@/lib/useLocale";
import { findNav } from "@/lib/nav";

const TITLES: Record<string, string> = {
  "/login": "Sign in", "/register": "Create account", "/forgot-password": "Forgot password",
  "/reset-password": "Reset password", "/verify-email": "Confirm your email", "/voice-consent": "Voice consent policy",
};

export function LocaleEffects() {
  const locale = useLocale();
  const t = useT();
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.lang = locale;
    const title = pathname.startsWith("/history/") ? "Edit transcript" : TITLES[pathname] ?? findNav(pathname)?.label;
    document.title = title ? `${t(title)} · Bondeth AI` : "Bondeth AI · បណ្ឌិត AI";
  }, [locale, pathname, t]);
  return null;
}
