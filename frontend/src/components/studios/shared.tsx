"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { PadlockDoodle } from "@/components/doodles";
import { EmptyState, Panel, useToast } from "@/components/ui";
import { ApiError, apiJson } from "@/lib/api";
import { useHydrated, useUser } from "@/lib/hooks";
import type { Voice } from "@/lib/types";

export function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** Short description line under the top bar title. */
export function Intro({ children }: { children: ReactNode }) {
  return <p className="mb-6 max-w-2xl text-sm text-ink-soft">{children}</p>;
}

/** Renders children only for signed-in users; otherwise a friendly sign-in prompt. */
export function RequireAuth({ children, why }: { children: ReactNode; why: string }) {
  const user = useUser();
  const hydrated = useHydrated();
  const pathname = usePathname();

  if (!hydrated) return <div className="h-80 animate-pulse rounded-2xl bg-surface" />;
  if (user) return <>{children}</>;
  return (
    <Panel className="mx-auto max-w-xl">
      <EmptyState
        doodle={<PadlockDoodle className="h-28 w-28 text-ink" />}
        title="Sign in to continue"
        action={
          <div className="flex gap-2">
            <Link href={`/login?next=${encodeURIComponent(pathname)}`}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink">Sign in</Link>
            <Link href={`/register?next=${encodeURIComponent(pathname)}`}
              className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-medium hover:bg-surface-2">Create account</Link>
          </div>
        }
      >
        {why}
      </EmptyState>
    </Panel>
  );
}

/** The signed-in user's saved voices, with local add/update/remove helpers. */
export function useVoices() {
  const toast = useToast();
  const [voices, setVoices] = useState<Voice[] | null>(null);

  const reload = useCallback(async () => {
    try {
      setVoices(await apiJson<Voice[]>("/api/v1/voices", { auth: "required" }));
    } catch (err) {
      setVoices([]);
      toast(errorText(err, "Couldn't load your voices."), "error");
    }
  }, [toast]);

  useEffect(() => {
    // Initial fetch; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return {
    voices,
    add: (v: Voice) => setVoices((list) => [v, ...(list ?? [])]),
    update: (v: Voice) => setVoices((list) => list?.map((x) => (x.id === v.id ? v : x)) ?? null),
    remove: (id: string) => setVoices((list) => list?.filter((x) => x.id !== id) ?? null),
  };
}
