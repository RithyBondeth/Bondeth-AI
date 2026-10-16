"use client";

import { Check, Copy, Search, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ReaderDoodle } from "@/components/doodles";
import { Intro, RequireAuth, errorText } from "@/components/studios/shared";
import { Badge, Button, EmptyState, IconButton, Panel, Segmented, cx, useToast } from "@/components/ui";
import { api, apiJson } from "@/lib/api";
import { LANG_LABEL, formatDate, formatSeconds } from "@/lib/format";
import type { Transcription } from "@/lib/types";

const PAGE = 20;

export function HistoryLibrary() {
  return (
    <>
      <Intro>Every transcript you make while signed in is saved here.</Intro>
      <RequireAuth why="Your transcription history is private to your account.">
        <Library />
      </RequireAuth>
    </>
  );
}

function Library() {
  const toast = useToast();
  const [items, setItems] = useState<Transcription[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<"all" | "km" | "en">("all");

  const load = useCallback(async (offset: number) => {
    const page = await apiJson<{ items: Transcription[]; total: number }>(
      `/api/v1/transcriptions?limit=${PAGE}&offset=${offset}`, { auth: "required" });
    setTotal(page.total);
    setItems((list) => (offset === 0 ? page.items : [...(list ?? []), ...page.items]));
  }, []);

  useEffect(() => {
    // Initial fetch; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(0).catch((err) => { setItems([]); toast(errorText(err, "Couldn't load history."), "error"); });
  }, [load, toast]);

  const remove = async (id: string) => {
    try {
      await api(`/api/v1/transcriptions/${id}`, { method: "DELETE", auth: "required" });
      setItems((list) => list?.filter((t) => t.id !== id) ?? null);
      setTotal((t) => t - 1);
    } catch (err) {
      toast(errorText(err, "Couldn't delete."), "error");
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter((t) => (lang === "all" || t.language_code === lang) && (!q || t.transcribed_text.toLowerCase().includes(q)));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <span className="sr-only">Search transcripts</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search… ស្វែងរក"
            className="khmer h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none" />
        </label>
        <Segmented label="Language" value={lang} onChange={setLang}
          options={[{ value: "all", label: "All" }, { value: "km", label: <span className="khmer">ខ្មែរ</span> }, { value: "en", label: "English" }]} />
        <span className="ml-auto text-sm text-ink-soft">{items ? `${total} saved` : ""}</span>
      </div>

      <Panel>
        {items === null ? (
          <div className="space-y-px p-2">{[0, 1, 2, 3].map((k) => <div key={k} className="h-20 animate-pulse rounded-xl bg-surface-2" />)}</div>
        ) : items.length === 0 ? (
          <EmptyState doodle={<ReaderDoodle className="h-28 w-40 text-ink" />} title="No transcripts yet"
            action={<Link href="/stt" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink">Transcribe something</Link>}>
            Transcripts you make in Speech to Text will show up here.
          </EmptyState>
        ) : shown.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-ink-soft">Nothing matches your search.</p>
        ) : (
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {shown.map((t) => <Row key={t.id} item={t} onDelete={() => remove(t.id)} />)}
            </AnimatePresence>
          </ul>
        )}
      </Panel>

      {items && items.length < total && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" loading={loadingMore}
            onClick={async () => { setLoadingMore(true); try { await load(items.length); } finally { setLoadingMore(false); } }}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

function Row({ item, onDelete }: { item: Transcription; onDelete: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const khmer = item.language_code === "km";

  return (
    <motion.li layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}
      className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 overflow-hidden px-5 py-4 transition-colors hover:bg-surface-2/60">
      <div className="contents">
        <p className={cx("line-clamp-2", khmer && "khmer")}>{item.transcribed_text}</p>
        <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          <Badge tone={khmer ? "accent" : "teal"}>{LANG_LABEL[item.language_code] ?? item.language_code}</Badge>
          {item.audio_duration_seconds != null && <span>{formatSeconds(item.audio_duration_seconds)}</span>}
          <span>·</span>
          <span className="whitespace-nowrap">{formatDate(item.created_at)}</span>
        </div>
      </div>
      <div className="col-start-2 row-start-1 flex items-start gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <IconButton label="Copy" onClick={async () => {
          await navigator.clipboard.writeText(item.transcribed_text);
          setCopied(true);
          toast("Copied to clipboard", "success");
          setTimeout(() => setCopied(false), 1500);
        }}>
          {copied ? <Check className="size-4 text-teal" /> : <Copy className="size-4" />}
        </IconButton>
        <IconButton label="Delete" onClick={onDelete} className="hover:bg-rose-soft hover:text-rose"><Trash2 className="size-4" /></IconButton>
      </div>
    </motion.li>
  );
}
