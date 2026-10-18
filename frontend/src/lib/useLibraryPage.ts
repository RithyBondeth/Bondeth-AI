"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiJson } from "@/lib/api";

type Page<T> = { items: T[]; total: number };
type State<T> = Page<T> & { key: string; error: string | null; loadingMore: boolean };

/** Debounced server filtering, with canceled requests unable to replace a newer result. */
export function useLibraryPage<T>(path: string, filters: string, limit = 20) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State<T> | null>(null);
  const request = useRef<AbortController | null>(null);
  const url = `${path}?limit=${limit}&${filters}`;
  const key = `${url}#${revision}`;
  const current = state?.key === key ? state : null;

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(async () => {
      try {
        const page = await apiJson<Page<T>>(url, { auth: "required", signal: controller.signal });
        if (!controller.signal.aborted) setState({ ...page, key, error: null, loadingMore: false });
      } catch (err) {
        if (!controller.signal.aborted) setState({ key, items: [], total: 0, loadingMore: false,
          error: err instanceof Error ? err.message : "Couldn't load your library." });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, key]);

  const loadMore = async () => {
    const controller = request.current;
    if (!current || current.loadingMore || !controller || controller.signal.aborted) return;
    setState({ ...current, error: null, loadingMore: true });
    try {
      const page = await apiJson<Page<T>>(`${url}&offset=${current.items.length}`, {
        auth: "required", signal: controller.signal,
      });
      if (!controller.signal.aborted) setState((previous) => previous?.key === key
        ? { ...previous, items: [...previous.items, ...page.items], total: page.total, loadingMore: false } : previous);
    } catch (err) {
      if (!controller.signal.aborted) setState((previous) => previous?.key === key
        ? { ...previous, loadingMore: false, error: err instanceof Error ? err.message : "Couldn't load more." } : previous);
    }
  };

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { items: current?.items ?? null, total: current?.total ?? 0,
    error: current?.error ?? null, loadingMore: current?.loadingMore ?? false, loadMore, reload };
}
