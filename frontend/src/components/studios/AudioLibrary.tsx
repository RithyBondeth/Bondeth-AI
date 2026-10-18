"use client";

import { useT } from "@/lib/useLocale";

import { Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SavedAudioPlayer } from "@/components/audio/SavedAudioPlayer";
import { WaveformDoodle } from "@/components/doodles";
import { useRecents } from "@/components/shell/Recents";
import { Intro, RequireAuth, errorText } from "@/components/studios/shared";
import { Badge, Button, Dialog, EmptyState, IconButton, Panel, Segmented, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { LANG_LABEL, formatDate, formatSeconds } from "@/lib/format";
import { useUser } from "@/lib/hooks";
import type { SavedAudio } from "@/lib/types";
import { useLibraryPage } from "@/lib/useLibraryPage";

export function AudioLibrary() {
  const t = useT();
  const user = useUser();
  return <>
    <Intro>{t("Your generated speech and voice clones are saved here automatically while signed in. Listen, download, or delete them anytime.")}</Intro>
    <RequireAuth why={t("Your audio library is private to your account.")}><Library key={user?.id} /></RequireAuth>
  </>;
}

function Library() {
  const t = useT();
  const toast = useToast();
  const { remove: removeRecent } = useRecents();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "tts" | "clone">("all");
  const [deleting, setDeleting] = useState<SavedAudio | null>(null);
  const [busy, setBusy] = useState(false);
  const filters = new URLSearchParams({ q: query.trim(), ...(kind !== "all" ? { kind } : {}) });
  const { items, total, error, loadingMore, loadMore, reload } = useLibraryPage<SavedAudio>("/api/v1/audio", filters.toString());
  const filtered = !!query.trim() || kind !== "all";

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/api/v1/audio/${deleting.id}`, { method: "DELETE", auth: "required" });
      removeRecent(deleting.id);
      setDeleting(null);
      reload();
      toast("Audio deleted", "success");
    } catch (err) {
      toast(errorText(err, "Couldn't delete this audio."), "error");
    } finally { setBusy(false); }
  };

  return <>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="relative min-w-0 flex-1 basis-56 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
        <span className="sr-only">{t("Search audio")}</span>
        <input type="search" maxLength={500} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search audio… ស្វែងរក")}
          className="ink-field khmer h-10 w-full rounded-xl border bg-surface pl-9 pr-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none" />
      </label>
      <Segmented label={t("Audio type")} value={kind} onChange={setKind}
        options={[{ value: "all", label: t("All") }, { value: "tts", label: t("Speech") }, { value: "clone", label: t("Clones") }]} />
      <span role="status" className="ml-auto text-sm text-ink-soft">{items && !error ? t(filtered ? "{count} matches" : "{count} saved", { count: total }) : ""}</span>
    </div>
    {error && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-rose">
      <p>{t(error)}</p><Button variant="secondary" size="sm" onClick={items?.length ? loadMore : reload}>{t("Try again")}</Button>
    </div>}
    <Panel aria-busy={items === null}>
      {items === null ? <div className="space-y-2 p-5">{[0, 1, 2].map((key) => <div key={key} className="h-32 animate-pulse rounded-xl bg-surface-2" />)}</div>
        : items.length === 0 && !error ? filtered
          ? <p className="px-5 py-12 text-center text-sm text-ink-soft">{t("Nothing matches your search.")}</p>
          : <EmptyState doodle={<WaveformDoodle className="h-14 w-36 text-ink" />} title={t("No saved audio yet")}
            action={<Link href="/tts" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink">{t("Generate speech")}</Link>}>
            {t("New speech and clone results will appear here, including clones finished while you were away.")}</EmptyState>
        : <ul className="divide-y divide-line">{items.map((item) => <AudioRow key={item.id} item={item} onDelete={() => setDeleting(item)} />)}</ul>}
    </Panel>
    {items && items.length < total && <div className="mt-4 flex justify-center">
      <Button variant="secondary" loading={loadingMore} onClick={loadMore}>{t("Load more")}</Button>
    </div>}
    <Dialog open={!!deleting} onClose={() => { if (!busy) setDeleting(null); }} title={t("Delete this audio?")}>
      <p className="mb-5 text-sm text-ink-soft">{t("This removes the saved clip from your account. Download a copy first if you want to keep it.")}</p>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>{t("Keep audio")}</Button>
        <Button variant="danger" loading={busy} onClick={remove}>{t("Delete audio")}</Button>
      </div>
    </Dialog>
  </>;
}

function AudioRow({ item, onDelete }: { item: SavedAudio; onDelete: () => void }) {
  const t = useT();
  return <li className="min-w-0 space-y-3 p-5">
    <div className="flex items-start gap-3">
      <p className="khmer min-w-0 flex-1 break-words text-sm leading-relaxed">{item.text}</p>
      <IconButton label={t("Delete saved audio")} onClick={onDelete} className="hover:bg-rose-soft hover:text-rose"><Trash2 className="size-4" /></IconButton>
    </div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
      <Badge tone={item.kind === "clone" ? "lilac" : "accent"}>{item.kind === "clone" ? t("Voice clone") : t("Speech")}</Badge>
      <span className="break-words">{item.kind === "tts" ? t(item.voice) : item.voice}</span><span>· {t(LANG_LABEL[item.language] ?? "Auto")}</span>
      <span>· {item.speed.toFixed(1)}×</span><span>· {formatSeconds(item.duration)}</span><span>· {formatDate(item.created_at)}</span>
    </div>
    <SavedAudioPlayer id={item.id} kind={item.kind} />
    {item.notice && <p role="status" className="rounded-lg bg-surface-2 p-3 text-sm text-ink">{t(item.notice)}</p>}
  </li>;
}
