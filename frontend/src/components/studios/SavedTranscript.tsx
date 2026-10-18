"use client";

import { useT } from "@/lib/useLocale";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RequireAuth, errorText } from "@/components/studios/shared";
import { TranscriptEditor } from "@/components/studios/TranscriptEditor";
import { Button, Panel } from "@/components/ui";
import { apiJson } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import type { TranscriptionDetail } from "@/lib/types";

export function SavedTranscript({ id, backLink = false }: { id: string; backLink?: boolean }) {
  const t = useT();
  const user = useUser();
  return <>
    {backLink && <Link href="/history" className="mb-5 inline-block text-sm font-medium text-accent hover:underline">{t("← Back to history")}</Link>}
    <RequireAuth why={t("Sign in to edit your saved transcript.")}>
      <Document key={`${user?.id}:${id}`} id={id} ownerId={user?.id ?? null} />
    </RequireAuth>
  </>;
}

function Document({ id, ownerId }: { id: string; ownerId: string | null }) {
  const t = useT();
  const [document, setDocument] = useState<TranscriptionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiJson<TranscriptionDetail>(`/api/v1/transcriptions/${id}`, { auth: "required", signal: controller.signal }).then(
      (value) => { if (!controller.signal.aborted) { setDocument(value); setError(null); } },
      (err) => { if (!controller.signal.aborted) setError(errorText(err, "Couldn't load this transcript.")); },
    );
    return () => controller.abort();
  }, [id, attempt]);
  if (error) return <Panel className="space-y-3 p-5"><p role="alert" className="text-sm text-rose">{t(error)}</p>
    <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>{t("Try again")}</Button></Panel>;
  if (!document) return <div aria-busy="true" aria-label={t("Loading transcript")} className="h-64 animate-pulse rounded-xl bg-surface-2" />;
  return <TranscriptEditor document={document} ownerId={ownerId} />;
}
