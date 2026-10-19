"use client";

import { useState } from "react";
import { Field, Input, Textarea } from "@/components/ui";
import type { ApiEndpoint } from "@/lib/api-reference";
import { useT } from "@/lib/useLocale";

export const PLAYGROUND_SELECT = "ink-field w-full min-w-0 rounded-xl border px-3 py-2.5 text-sm text-ink";

export function ApiRequestFields({ endpoint }: { endpoint: ApiEndpoint }) {
  const t = useT();
  const [source, setSource] = useState("upload");
  if (endpoint.json) return <Field label={t("JSON request body")}>
    {(id) => <Textarea id={id} name="json" rows={8} required spellCheck={false} defaultValue={JSON.stringify(endpoint.json, null, 2)} className="font-mono text-xs" />}
  </Field>;
  if (!endpoint.form) return <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-soft">{t("This endpoint has no request body.")}</p>;
  const clone = endpoint.id === "voice-cloning";
  return <div className="space-y-4">
    {clone && <>
      <Field label={t("Text to speak")}>
        {(id) => <Textarea id={id} name="text" required rows={3} defaultValue={endpoint.form?.text} />}
      </Field>
      <Field label={t("Voice source")}>
        {(id) => <select id={id} value={source} onChange={(event) => setSource(event.target.value)} className={PLAYGROUND_SELECT}>
          <option value="upload">{t("Upload a reference")}</option><option value="saved">{t("Use a saved voice ID")}</option>
        </select>}
      </Field>
    </>}
    {clone && source === "saved" ? <Field label={t("Saved voice ID")}>
      {(id) => <Input id={id} name="voice_id" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />}
    </Field> : <>
      <Field label={t(clone ? "Reference audio" : "Audio file")} hint={t("Choose a local audio file. It is uploaded only when you send the request.")}>
        {(id) => <Input key={clone ? "reference" : "recording"} id={id} name={clone ? "reference_audio" : "file"} type="file" accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac" required className="text-xs" />}
      </Field>
      {clone && <>
        <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
          <input type="checkbox" name="consent" value="true" required className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
          <span>{t("This is ")}<strong>{t("my voice")}</strong>{t(", or I have the speaker's ")}<strong>{t("explicit permission")}</strong> {t(" to clone it.")}</span>
        </label>
        <Field label={t("Reference transcript (optional)")}>
          {(id) => <Textarea id={id} name="reference_text" rows={2} />}
        </Field>
      </>}
    </>}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("Language")}>
        {(id) => <select id={id} name={clone ? "lang" : "language"} defaultValue={endpoint.form?.lang ?? "auto"} className={PLAYGROUND_SELECT}>
          <option value="auto">{t("Auto")}</option><option value="km">{t("Khmer")}</option><option value="en">{t("English")}</option>
        </select>}
      </Field>
      {clone && <Field label={t("Speed")}>
        {(id) => <Input id={id} name="speed" type="number" min={0.5} max={2} step={0.1} defaultValue={1} required />}
      </Field>}
    </div>
    {!clone && <label className="flex items-center gap-2 text-xs text-ink-soft"><input type="checkbox" name="keep_source_audio" value="true" />{t("Keep source audio (requires authentication)")}</label>}
  </div>;
}
