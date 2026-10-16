"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { apiJson, onUsageChange, sessionStore, type User } from "@/lib/api";
import type { Usage } from "@/lib/types";

const noopSubscribe = () => () => {};

/** False during server render and hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** The signed-in user, or null. Updates on sign-in/out, including from other tabs. */
export function useUser(): User | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.getServer)?.user ?? null;
}

/** Today's usage and allowances; refetched on sign-in/out and after each metered request. */
export function useUsage(): Usage | null {
  const user = useUser();
  const userId = user?.id;
  const verified = user?.email_verified;
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => apiJson<Usage>("/api/v1/usage").then((u) => active && setUsage(u), () => {});
    load();
    const off = onUsageChange(load);
    return () => {
      active = false;
      off();
    };
  }, [userId, verified]);
  return usage;
}
