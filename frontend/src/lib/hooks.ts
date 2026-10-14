"use client";

import { useSyncExternalStore } from "react";

import { sessionStore, type User } from "@/lib/api";

const noopSubscribe = () => () => {};

/** False during server render and hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** The signed-in user, or null. Updates on sign-in/out, including from other tabs. */
export function useUser(): User | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.getServer)?.user ?? null;
}
