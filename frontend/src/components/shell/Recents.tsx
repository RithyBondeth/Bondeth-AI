"use client";

import { Clock, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { WaveformDoodle } from "@/components/doodles";
import { EmptyState, IconButton, Panel, PanelHeader, cx } from "@/components/ui";

/**
 * Clips generated this session (TTS and clones). Lives in the studio layout, so the
 * list survives moving between tools; audio stays in memory and is gone on reload.
 */

export type Recent = { id: string; kind: "tts" | "clone"; text: string; voice: string; blob: Blob; createdAt: number };

type RecentsApi = {
  items: Recent[];
  add: (item: Omit<Recent, "id" | "createdAt">) => void;
  remove: (id: string) => void;
};

const RecentsContext = createContext<RecentsApi>({ items: [], add: () => {}, remove: () => {} });

export function RecentsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Recent[]>([]);
  const add = useCallback((item: Omit<Recent, "id" | "createdAt">) => {
    setItems((list) => [{ ...item, id: crypto.randomUUID(), createdAt: Date.now() }, ...list].slice(0, 20));
  }, []);
  const remove = useCallback((id: string) => setItems((list) => list.filter((r) => r.id !== id)), []);
  const value = useMemo(() => ({ items, add, remove }), [items, add, remove]);
  return <RecentsContext.Provider value={value}>{children}</RecentsContext.Provider>;
}

export const useRecents = () => useContext(RecentsContext);

export function RecentsPanel({ kind, className }: { kind: Recent["kind"]; className?: string }) {
  const { items, remove } = useRecents();
  const mine = items.filter((r) => r.kind === kind);

  return (
    <Panel className={className}>
      <PanelHeader title="Recent" km="ថ្មីៗ">
        <span className="text-xs text-ink-soft">This session</span>
      </PanelHeader>
      {mine.length === 0 ? (
        <EmptyState doodle={<WaveformDoodle className="h-12 w-32 text-ink" />} title="Nothing generated yet">
          Your clips will collect here while you work.
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
                    <IconButton label="Remove from recent" onClick={() => remove(r.id)} className="-mr-2 -mt-1 size-8 hover:text-rose">
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                  <AudioPlayer blob={r.blob} filename={`bondeth-${r.kind}.wav`} tone={r.kind === "clone" ? "lilac" : "accent"} compact />
                  <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <Clock className="size-3" />
                    {new Date(r.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {r.voice}
                  </p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
