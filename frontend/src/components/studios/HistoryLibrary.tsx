"use client";

import { useT } from "@/lib/useLocale";

import { Check, Copy, Pencil, Search, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { ReaderDoodle } from "@/components/doodles";
import { Intro, RequireAuth, errorText } from "@/components/studios/shared";
import { Badge, Button, EmptyState, IconButton, Panel, Segmented, cx, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import { useLibraryPage } from "@/lib/useLibraryPage";
import { LANG_LABEL, formatDate, formatSeconds } from "@/lib/format";
import type { Transcription } from "@/lib/types";

export function HistoryLibrary() {
  const t = useT();
  const user = useUser();
  return (
    <>
      <Intro>{t("Every transcript you make while signed in is saved here.")}</Intro>
      <RequireAuth why={t("Your transcription history is private to your account.")}>
        <Library key={user?.id} />
      </RequireAuth>
    </>
  );
}

function Library() {
  const t = useT();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<"all" | "km" | "en">("all");
  const filters = new URLSearchParams({ q: query.trim(), ...(lang !== "all" ? { language: lang } : {}) });
  const { items, total, loadingMore, error, loadMore, reload } = useLibraryPage<Transcription>(
    "/api/v1/transcriptions", filters.toString());

  const remove = async (id: string) => {
    try {
      await api(`/api/v1/transcriptions/${id}`, { method: "DELETE", auth: "required" });
      reload();
    } catch (err) {
      toast(errorText(err, "Couldn't delete."), "error");
    }
  };

  const filtered = !!query.trim() || lang !== "all";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <span className="sr-only">{t("Search transcripts")}</span>
          <input type="search" maxLength={500} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search… ស្វែងរក")}
            className="ink-field khmer h-10 w-full rounded-xl border bg-surface pl-9 pr-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none" />
        </label>
        <Segmented label={t("Language")} value={lang} onChange={setLang}
          options={[{ value: "all", label: t("All") }, { value: "km", label: <span className="khmer">ខ្មែរ</span> }, { value: "en", label: t("English") }]} />
        <span role="status" className="ml-auto text-sm text-ink-soft">{items && !error ? t(filtered ? "{count} matches" : "{count} saved", { count: total }) : ""}</span>
      </div>

      {error && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-rose">
        <p>{t(error)}</p><Button variant="secondary" size="sm" onClick={items?.length ? loadMore : reload}>{t("Try again")}</Button>
      </div>}
      <Panel aria-busy={items === null}>
        {items === null ? (
          <div className="space-y-px p-2">{[0, 1, 2, 3].map((k) => <div key={k} className="h-20 animate-pulse rounded-xl bg-surface-2" />)}</div>
        ) : items.length === 0 && filtered && !error ? (
          <p className="px-5 py-12 text-center text-sm text-ink-soft">{t("Nothing matches your search.")}</p>
        ) : items.length === 0 && !error ? (
          <EmptyState doodle={<ReaderDoodle className="h-28 w-40 text-ink" />} title={t("No transcripts yet")}
            action={<Link href="/stt" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink">{t("Transcribe something")}</Link>}>
            {t("Transcripts you make in Speech to Text will show up here.")}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {items.map((t) => <Row key={t.id} item={t} onDelete={() => remove(t.id)} />)}
            </AnimatePresence>
          </ul>
        )}
      </Panel>

      {items && items.length < total && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" loading={loadingMore}
            onClick={loadMore}>
            {t("Load more")}</Button>
        </div>
      )}
    </>
  );
}

function Row({ item, onDelete }: { item: Transcription; onDelete: () => void }) {
  const t = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const khmer = item.language_code === "km";

  return (
    <motion.li layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}
      className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 overflow-hidden px-5 py-4 transition-colors hover:bg-surface-2/60">
      <div className="contents">
        <Link href={`/history/${item.id}`} className={cx("line-clamp-2 hover:text-accent hover:underline", khmer && "khmer")}>{item.transcribed_text || t("Empty transcript")}</Link>
        <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          <Badge tone={khmer ? "accent" : "teal"}>{t(LANG_LABEL[item.language_code] ?? item.language_code)}</Badge>
          {item.audio_duration_seconds != null && <span>{formatSeconds(item.audio_duration_seconds)}</span>}
          <span>·</span>
          <span className="whitespace-nowrap">{formatDate(item.created_at)}</span>
        </div>
      </div>
      <div className="col-start-2 row-start-1 flex items-start gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <Link href={`/history/${item.id}`} aria-label={t("Edit transcript")} title={t("Edit transcript")}
          className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"><Pencil className="size-4" /></Link>
        <IconButton label={t("Copy")} onClick={async () => {
          await navigator.clipboard.writeText(item.transcribed_text);
          setCopied(true);
          toast("Copied to clipboard", "success");
          setTimeout(() => setCopied(false), 1500);
        }}>
          {copied ? <Check className="size-4 text-teal" /> : <Copy className="size-4" />}
        </IconButton>
        <IconButton label={t("Delete")} onClick={onDelete} className="hover:bg-rose-soft hover:text-rose"><Trash2 className="size-4" /></IconButton>
      </div>
    </motion.li>
  );
}
