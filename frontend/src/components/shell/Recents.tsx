"use client";

import { formatTime } from "@/lib/format";
import { useT } from "@/lib/useLocale";

import { Clock, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { WaveformDoodle } from "@/components/doodles";
import { EmptyState, IconButton, Panel, PanelHeader, cx } from "@/components/ui";
import { useUser } from "@/lib/hooks";

/**
 * Clips generated this session (TTS and clones). Lives in the studio layout, so the
 * list survives moving between tools. Signed-in outputs also live in /audio;
 * anonymous clips only stay in memory until reload.
 */

export type Recent = { id: string; kind: "tts" | "clone"; text: string; voice: string; blob: Blob; createdAt: number; notice?: string; savedId?: string };

type RecentsApi = {
  items: Recent[];
  add: (item: Omit<Recent, "id" | "createdAt">) => void;
  remove: (id: string) => void;
};

const RecentsContext = createContext<RecentsApi>({ items: [], add: () => {}, remove: () => {} });

export function RecentsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Recent[]>([]);
  const add = useCallback((item: Omit<Recent, "id" | "createdAt">) => {
    const id = item.savedId ?? crypto.randomUUID();
    setItems((list) => [{ ...item, id, createdAt: Date.now() }, ...list.filter((r) => r.id !== id)].slice(0, 20));
  }, []);
  const remove = useCallback((id: string) => setItems((list) => list.filter((r) => r.id !== id)), []);
  const value = useMemo(() => ({ items, add, remove }), [items, add, remove]);
  return <RecentsContext.Provider value={value}>{children}</RecentsContext.Provider>;
}

export const useRecents = () => useContext(RecentsContext);

export function RecentsPanel({ kind, className }: { kind: Recent["kind"]; className?: string }) {
  const t = useT();
  const { items, remove } = useRecents();
  const user = useUser();
  const mine = items.filter((r) => r.kind === kind);

  return (
    <Panel className={className}>
      <PanelHeader title={t("Recent")} km="ថ្មីៗ">
        {user ? <Link href="/audio" className="text-xs font-medium text-accent hover:underline">{t("Audio library →")}</Link>
          : <span className="text-xs text-ink-soft">{t("This session")}</span>}
      </PanelHeader>
      {mine.length === 0 ? (
        <EmptyState doodle={<WaveformDoodle className="h-12 w-32 text-ink" />} title={t("Nothing generated yet")}>
          {user ? t("New clips appear here. Open your audio library for previously saved clips.") : t("Your clips will collect here while you work. Sign in to save new clips to your library.")}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {mine.map((r, i) => (
              <motion.li key={r.id} layout
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <div className="space-y-2.5 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <p className={cx("khmer line-clamp-2 flex-1 text-sm", i > 0 && "text-ink-soft")}>{r.text}</p>
                    <IconButton label={t("Remove from recent")} onClick={() => remove(r.id)} className="-mr-2 -mt-1 size-8 hover:text-rose">
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                  <AudioPlayer blob={r.blob} filename={`bondeth-${r.kind}.wav`} tone={r.kind === "clone" ? "lilac" : "accent"} compact />
                  {r.notice && <p role="status" className="rounded-lg bg-surface-2 p-3 text-sm text-ink">{t(r.notice)}</p>}
                  <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <Clock className="size-3" />
                    {formatTime(r.createdAt)} · {r.kind === "tts" ? t(r.voice) : r.voice}
                  </p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {user && mine.some((r) => r.savedId) && <p className="border-t border-line px-5 py-3 text-xs text-ink-soft">
        {t("Saved to your account. ")}<Link href="/audio" className="font-medium text-accent hover:underline">{t("Open audio library →")}</Link>
      </p>}
    </Panel>
  );
}
