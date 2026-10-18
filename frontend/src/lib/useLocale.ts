"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getLocale, getServerLocale, subscribeLocale, translate, type MessageValues } from "./i18n";

/** The English server snapshot keeps hydration deterministic; stored preferences apply after hydration. */
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getServerLocale);
}
export function useT() {
  const locale = useLocale();
  return useCallback((message: string, values?: MessageValues) => translate(locale, message, values), [locale]);
}
