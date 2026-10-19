"use client";

import { useMemo, useState } from "react";
import { findTranscriptMatches, indexTranscript, replacementError, type TranscriptMatch } from "./transcriptSearch";
import type { TranscriptDraft } from "./types";

export function useTranscriptSearch(draft: TranscriptDraft) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [anchor, setAnchor] = useState<{ segment: number; offset: number } | null>(null);
  const searching = open && query.length > 0;
  const index = useMemo(() => searching ? indexTranscript(draft, matchCase) : [], [draft, matchCase, searching]);
  const result = useMemo(() => findTranscriptMatches(index, query, matchCase), [index, query, matchCase]);
  const candidate = anchor ? result.matches.findIndex((match) => match.segment > anchor.segment
    || match.segment === anchor.segment && match.start >= anchor.offset) : 0;
  const current = Math.max(0, candidate);
  const selected = result.matches[current];
  const bySegment = useMemo(() => {
    const groups = new Map<number, Array<TranscriptMatch & { ordinal: number }>>();
    result.matches.forEach((match, ordinal) => {
      const group = groups.get(match.segment) ?? [];
      group.push({ ...match, ordinal }); groups.set(match.segment, group);
    });
    return groups;
  }, [result]);
  const allProblem = useMemo(() => result.matches.length ? replacementError(draft, result.matches, replacement) : null,
    [draft, result.matches, replacement]);
  const oneProblem = selected ? replacementError(draft, [selected], replacement) : null;

  return { open, setOpen, query, replacement, setReplacement, matchCase, matches: result.matches,
    overflow: result.overflow, current, selected, bySegment, allProblem, oneProblem,
    setQuery: (value: string) => { setQuery(value); setAnchor(null); },
    setMatchCase: (value: boolean) => { setMatchCase(value); setAnchor(null); },
    select: (match: TranscriptMatch) => setAnchor({ segment: match.segment, offset: match.start }),
    afterReplace: (match?: TranscriptMatch) => setAnchor(match ? { segment: match.segment, offset: match.start + replacement.length } : null),
  };
}
