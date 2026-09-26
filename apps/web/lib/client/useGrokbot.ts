"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { grokbotError, type GrokbotErrorView } from "./grokbot";

export interface GrokbotState<T> {
  data: T | null;
  error: GrokbotErrorView | null;
  loading: boolean;
  /** Fetch again; `refresh` asks the server for a newly generated answer instead of the cached one. */
  load: (refresh?: boolean) => Promise<void>;
}

/**
 * Fetches a Grokbot answer when `enabled` (panels load on first open, so closed panels cost no
 * model call). Unlike useApi it keeps the classified error, so "not on this server yet" renders as
 * a calm notice instead of a failure. A failed regenerate keeps the last answer on screen.
 */
export function useGrokbot<T>(fetcher: (refresh: boolean) => Promise<T>, key: string, enabled = true): GrokbotState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<GrokbotErrorView | null>(null);
  const [loading, setLoading] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await fetcherRef.current(refresh);
      if (mine === seq.current) setData(d);
    } catch (e) {
      if (mine === seq.current) setError(grokbotError(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    if (enabled) void load(false);
    else seq.current++;
  }, [key, enabled, load]);

  return { data, error, loading, load };
}
