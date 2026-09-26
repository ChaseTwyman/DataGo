"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Fetch on mount / when `key` changes, optionally re-fetch every `intervalMs`. A failed refresh keeps
 * the last good data (so a blip doesn't blank the map) and surfaces the error.
 */
export function useApi<T>(fetcher: (() => Promise<T>) | null, key: string, intervalMs?: number): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(fetcher !== null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const f = fetcherRef.current;
    if (!f) return;
    const mine = ++seq.current;
    try {
      const d = await f();
      if (mine !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetcherRef.current) return;
    setLoading(true);
    setData(null);
    void refresh();
    if (!intervalMs) return;
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
  }, [key, intervalMs, refresh]);

  return { data, error, loading, refresh };
}
