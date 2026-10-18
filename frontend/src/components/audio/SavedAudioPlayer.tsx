"use client";

import { useT } from "@/lib/useLocale";

import { Download, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { errorText } from "@/components/studios/shared";
import { Button, IconButton } from "@/components/ui";
import { api } from "@/lib/api";

/** Fetch private audio only when the user plays or downloads a clip. */
export function SavedAudioPlayer({ id, kind }: { id: string; kind: "tts" | "clone" }) {
  const t = useT();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const load = async (download: boolean) => {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/api/v1/audio/${id}/file`, { auth: "required", signal: controller.signal });
      const audio = await res.blob();
      if (controller.signal.aborted) return;
      setAutoPlay(!download);
      setBlob(audio);
      if (download) {
        const url = URL.createObjectURL(audio);
        Object.assign(document.createElement("a"), { href: url, download: `bondeth-${kind}-${id}.wav` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(errorText(err, "Couldn't load this audio."));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  if (blob) return <AudioPlayer blob={blob} filename={`bondeth-${kind}-${id}.wav`}
    tone={kind === "clone" ? "lilac" : "accent"} compact autoPlay={autoPlay} />;
  return <div className="space-y-2">
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" icon={<Play className="size-3.5" />} loading={busy} onClick={() => load(false)}>
        {t("Listen")}</Button>
      <IconButton label={t("Download audio")} disabled={busy} onClick={() => load(true)}><Download className="size-4" /></IconButton>
    </div>
    {error && <p role="alert" className="text-sm text-rose">{t(error)} {t(" Try listening again.")}</p>}
  </div>;
}
