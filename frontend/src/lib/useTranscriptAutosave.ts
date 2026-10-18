"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiJson, sessionStore } from "@/lib/api";
import { transcriptDraft } from "@/lib/subtitles";
import type { TranscriptDocument, TranscriptDraft, TranscriptionDetail } from "@/lib/types";

type Status = "saved" | "pending" | "saving" | "error" | "conflict";
const serialize = (draft: TranscriptDraft) => JSON.stringify(draft);
const fromDocument = (document: TranscriptDocument) => transcriptDraft(document.transcribed_text, document.segments);

function initialDraft(document: TranscriptDocument, key: string | null) {
  const saved = fromDocument(document);
  try {
    const pending = key ? JSON.parse(sessionStorage.getItem(key) ?? "null") : null;
    if (pending && Number.isInteger(pending.revision) && typeof pending.draft?.text === "string"
      && pending.draft.text.length <= 500000 && (pending.draft.segments === null
      || Array.isArray(pending.draft.segments) && pending.draft.segments.length <= 20000
      && pending.draft.segments.every((s: { text: unknown; start: number; end: number }) => typeof s.text === "string"
        && s.text.length <= 10000 && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start))) {
      const draft = transcriptDraft(pending.draft.text, pending.draft.segments);
      return { draft, conflict: pending.revision !== document.revision && serialize(draft) !== serialize(saved) };
    }
  } catch { /* Draft storage is optional; server autosave still works. */ }
  return { draft: saved, conflict: false };
}

/** Serial writes preserve typing during a save; revisions protect other tabs' edits. */
export function useTranscriptAutosave(document: TranscriptDocument, ownerId: string | null) {
  const storageKey = document.id && ownerId ? `bondeth.transcript-draft.v1:${ownerId}:${document.id}` : null;
  const [initial] = useState(() => initialDraft(document, storageKey));
  const [draft, setDraft] = useState(initial.draft);
  const [saved, setSaved] = useState(document);
  const [savedKey, setSavedKey] = useState(() => serialize(fromDocument(document)));
  const [status, setStatus] = useState<Status>(initial.conflict ? "conflict" : "saved");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const machine = useRef({ draft: initial.draft, savedKey: serialize(fromDocument(document)), revision: document.revision,
    conflict: initial.conflict, mounted: true, inFlight: null as Promise<boolean> | null });
  const id = document.id;
  const dirty = serialize(draft) !== savedKey;

  const remember = useCallback(() => {
    if (!storageKey) return;
    const current = machine.current;
    try {
      if (serialize(current.draft) === current.savedKey) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify({ draft: current.draft, revision: current.revision }));
    } catch { /* Storage may be disabled or full. */ }
  }, [storageKey]);

  const save = useCallback(async function persist(): Promise<boolean> {
    const current = machine.current;
    if (!id || serialize(current.draft) === current.savedKey) return true;
    if (current.conflict) return false;
    if (current.inFlight) {
      const success = await current.inFlight;
      return success ? persist() : false;
    }
    if (sessionStore.get()?.user.id !== ownerId) {
      if (current.mounted) { setStatus("error"); setError("Sign in again to save your changes."); }
      return false;
    }
    const snapshot = current.draft;
    const snapshotKey = serialize(snapshot);
    const body = JSON.stringify({ revision: current.revision,
      ...(snapshot.segments ? { segments: snapshot.segments } : { text: snapshot.text }) });
    if (current.mounted) { setStatus("saving"); setError(null); }
    current.inFlight = (async () => {
      try {
        const response = await apiJson<TranscriptionDetail>(`/api/v1/transcriptions/${id}`, {
          method: "PATCH", auth: "required", headers: { "Content-Type": "application/json" }, body,
          keepalive: new TextEncoder().encode(body).length < 60000,
        });
        current.revision = response.revision;
        current.savedKey = snapshotKey;
        remember();
        if (current.mounted) {
          setSaved(response); setSavedKey(snapshotKey);
          setStatus(serialize(current.draft) === snapshotKey ? "saved" : "pending");
        }
        return true;
      } catch (err) {
        current.conflict = err instanceof ApiError && err.status === 409;
        if (current.mounted) {
          setStatus(current.conflict ? "conflict" : "error");
          setError(err instanceof Error ? err.message : "Couldn't save your changes.");
        }
        return false;
      } finally { current.inFlight = null; }
    })();
    const success = await current.inFlight;
    return success && serialize(current.draft) !== current.savedKey ? persist() : success;
  }, [id, ownerId, remember]);

  const edit = (next: TranscriptDraft) => {
    machine.current.draft = next;
    setDraft(next);
    if (!machine.current.conflict) { setStatus("pending"); setError(null); }
    remember();
  };

  useEffect(() => {
    if (!id || !dirty) return;
    const timer = setTimeout(() => { void save(); }, 700);
    return () => clearTimeout(timer);
  }, [draft, dirty, id, save]);

  useEffect(() => {
    const current = machine.current;
    current.mounted = true;
    remember();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (serialize(machine.current.draft) !== machine.current.savedKey) {
        event.preventDefault(); event.returnValue = ""; void save();
      }
    };
    const onHidden = () => { if (window.document.visibilityState === "hidden") void save(); };
    window.addEventListener("beforeunload", beforeUnload);
    window.document.addEventListener("visibilitychange", onHidden);
    return () => {
      current.mounted = false;
      window.removeEventListener("beforeunload", beforeUnload);
      window.document.removeEventListener("visibilitychange", onHidden);
      void save();
    };
  }, [remember, save]);

  const resolveConflict = async (keepDraft: boolean) => {
    if (!id) return;
    setResolving(true);
    try {
      const response = await apiJson<TranscriptionDetail>(`/api/v1/transcriptions/${id}`, { auth: "required" });
      const current = machine.current;
      current.savedKey = serialize(fromDocument(response));
      current.revision = response.revision;
      current.conflict = false;
      if (!keepDraft) { current.draft = fromDocument(response); setDraft(current.draft); }
      setSaved(response); setSavedKey(current.savedKey); setError(null); setStatus("saved");
      remember();
      if (keepDraft) await save();
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't load the saved transcript."); }
    finally { setResolving(false); }
  };

  return { draft, saved, dirty, status, error, resolving, edit, save, resolveConflict };
}
