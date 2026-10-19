"use client";

import type { Ref } from "react";
import { Button, IconButton, Input } from "@/components/ui";
import { X } from "lucide-react";
import type { useTranscriptSearch } from "@/lib/useTranscriptSearch";
import { useT } from "@/lib/useLocale";

export function TranscriptFindReplace({ search, inputRef, resolving, timed, onMove, onReplace, onClose }: {
  search: ReturnType<typeof useTranscriptSearch>; inputRef: Ref<HTMLInputElement>; resolving: boolean; timed: boolean;
  onMove: (direction: number) => void; onReplace: (all: boolean) => void; onClose: () => void;
}) {
  const t = useT();
  const count = search.matches.length;
  return <section data-transcript-search aria-label={t("Transcript find and replace")} className="sticky top-16 z-20 max-h-[60dvh] space-y-3 overflow-y-auto border-b border-line bg-surface p-5">
    <div className="flex items-center gap-2"><h3 className="mr-auto text-sm font-medium">{t("Find and replace")}</h3>
      <IconButton label={t("Close find and replace")} onClick={onClose}><X className="size-4" /></IconButton></div>
    <label className="block space-y-1.5 text-sm"><span>{t("Find in transcript")}</span>
      <Input ref={inputRef} type="search" maxLength={500} value={search.query} onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onMove(event.shiftKey ? -1 : 1); }
        }} />
    </label>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="inline-flex items-center gap-2 text-xs text-ink-soft">
        <input type="checkbox" checked={search.matchCase} onChange={(event) => search.setMatchCase(event.target.checked)} className="size-4 accent-[var(--accent)]" />{t("Match case")}
      </label>
      <span role="status" className="text-xs text-ink-soft">{t(search.overflow ? "More than 10,000 matches. Narrow your search."
        : count ? "Match {current} of {total}" : search.query ? "No matches" : "Enter text to find matches.", { current: search.current + 1, total: count })}</span>
      <div className="flex max-w-full flex-wrap gap-1.5 sm:ml-auto">
        <Button variant="secondary" size="sm" disabled={!count} onClick={() => onMove(-1)}>{t("Previous match")}</Button>
        <Button variant="secondary" size="sm" disabled={!count} onClick={() => onMove(1)}>{t("Next match")}</Button>
      </div>
    </div>
    <label className="block space-y-1.5 text-sm"><span>{t("Replace with")}</span>
      <Input data-transcript-replacement maxLength={10000} value={search.replacement} onChange={(event) => search.setReplacement(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (count && !search.oneProblem && !resolving) onReplace(false); }
        }} />
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" disabled={!count || !!search.oneProblem || resolving} onClick={() => onReplace(false)}>{t("Replace one")}</Button>
      <Button size="sm" disabled={!count || !!search.allProblem || resolving} onClick={() => onReplace(true)}>{t("Replace all")}</Button>
      {count > 0 && timed && <span className="text-xs text-ink-soft">{t("{count} segments contain matches.", { count: search.bySegment.size })}</span>}
    </div>
    {search.allProblem && <p role="alert" className="text-sm text-rose">{t(search.allProblem)}</p>}
    <p className="text-xs leading-relaxed text-ink-soft">{t("Matches respect Khmer character clusters and stay within each segment. One Undo restores a bulk replacement; timestamps stay unchanged.")}</p>
  </section>;
}
