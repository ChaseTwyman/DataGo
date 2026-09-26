"use client";
/**
 * Live submission stream. Same hook API in both modes:
 *  - realtime: Supabase postgres_changes on `submissions` (and `bounties`) trigger a refetch
 *    through the API (which signs media URLs), plus a slow backstop refresh;
 *  - polling: GET /api/submissions every 2 s (local backend, or realtime unavailable).
 * Realtime events only invalidate; rows always come from the API so both paths render the same data.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { SubmissionWithMedia } from "@groundtruth/shared";
import { getBrowserSupabase, supabaseConfigured } from "@/lib/supabase/browser";
import { api, errorMessage } from "./api";
import { useHealth } from "./health";
import {
  chooseStreamMode,
  initialStreamState,
  POLL_INTERVAL_MS,
  REALTIME_BACKSTOP_MS,
  streamReducer,
  type StreamMode,
} from "./stream";

export interface StreamOptions {
  bountyId?: string;
  status?: SubmissionWithMedia["status"];
  limit?: number;
  enabled?: boolean;
  /** Called on any `bounties` row change (realtime) — e.g. to refresh coverage. */
  onBountyChange?: () => void;
}

export interface SubmissionStream {
  submissions: SubmissionWithMedia[];
  loading: boolean;
  error: string | null;
  freshIds: string[];
  updatedAt: number | null;
  mode: StreamMode | null;
  refresh: () => Promise<void>;
  remove: (id: string) => void;
}

export function useSubmissionStream(opts: StreamOptions = {}): SubmissionStream {
  const { bountyId, status, limit = 50, enabled = true } = opts;
  const { state: health } = useHealth();
  const mode = chooseStreamMode(health, supabaseConfigured());
  const [state, dispatch] = useReducer(streamReducer, initialStreamState);
  const onBountyChange = useRef(opts.onBountyChange);
  onBountyChange.current = opts.onBountyChange;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await api.submissions({ bounty_id: bountyId, status, limit });
      dispatch({ type: "loaded", submissions: r.submissions, at: Date.now() });
    } catch (e) {
      dispatch({ type: "error", message: errorMessage(e) });
    } finally {
      inFlight.current = false;
    }
  }, [bountyId, status, limit]);

  useEffect(() => {
    dispatch({ type: "reset" });
  }, [bountyId, status, limit]);

  useEffect(() => {
    if (!enabled || mode === null) return;
    void refresh();

    if (mode === "polling") {
      const t = setInterval(() => void refresh(), POLL_INTERVAL_MS);
      return () => clearInterval(t);
    }

    const sb = getBrowserSupabase();
    if (!sb) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void refresh();
      }, 250);
    };
    const channel = sb
      .channel(`gt-stream-${bountyId ?? "all"}-${status ?? "any"}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submissions", ...(bountyId ? { filter: `bounty_id=eq.${bountyId}` } : {}) },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bounties", ...(bountyId ? { filter: `id=eq.${bountyId}` } : {}) },
        () => onBountyChange.current?.(),
      )
      .subscribe();
    const backstop = setInterval(() => void refresh(), REALTIME_BACKSTOP_MS);
    return () => {
      clearInterval(backstop);
      if (pending) clearTimeout(pending);
      void sb.removeChannel(channel);
    };
  }, [enabled, mode, refresh, bountyId, status]);

  const remove = useCallback((id: string) => dispatch({ type: "remove", id }), []);

  return {
    submissions: state.submissions,
    loading: state.loading,
    error: state.error,
    freshIds: state.freshIds,
    updatedAt: state.updatedAt,
    mode,
    refresh,
    remove,
  };
}
