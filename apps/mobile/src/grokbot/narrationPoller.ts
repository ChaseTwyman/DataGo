/**
 * Verification companion, transport side: poll GET /api/grokbot/submissions/:id/narration?after=n
 * until the server says `done`. Pure (fetch + timers injected), unit-tested.
 *
 * - Every line is delivered once, in seq order, however the server interprets `after` (> or ≥)
 *   and even if it resends old lines: the poller dedupes by seq.
 * - `final` is delivered once.
 * - Errors back off (interval doubles per consecutive failure, capped); 404/405/501 mean the
 *   endpoint isn't deployed yet → stop quietly ("unsupported"); 401/403 → stop.
 * - A hard cap on total polling time so a server that never says `done` can't poll forever.
 * - `live` is true when the first response was not already done: the contributor is watching the
 *   verification happen (the screen speaks only then — not when reopening an old result).
 */
import { ApiError } from "../api/http";
import type { LenientGrokbotMessage, LenientNarrationLine, LenientNarrationResponse } from "./schemas";

export type NarrationStopReason = "done" | "unsupported" | "forbidden" | "timeout" | "stopped";

export interface NarrationPollerDeps {
  fetch: (after: number | undefined) => Promise<LenientNarrationResponse>;
  onLines: (lines: LenientNarrationLine[], live: boolean) => void;
  onFinal: (message: LenientGrokbotMessage, live: boolean) => void;
  onStop?: (reason: NarrationStopReason) => void;
  /** Every failed fetch that will be retried (for logs). */
  onError?: (e: unknown) => void;
  intervalMs?: number;
  maxBackoffMs?: number;
  maxDurationMs?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

export const NARRATION_INTERVAL_MS = 1500;

export function isUnsupported(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
}

function isForbidden(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

/** Starts immediately. Returns a stop function (idempotent). */
export function pollNarration(d: NarrationPollerDeps): () => void {
  const setT = d.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = d.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = d.now ?? (() => Date.now());
  const base = d.intervalMs ?? NARRATION_INTERVAL_MS;
  const cap = d.maxBackoffMs ?? 12_000;
  const deadline = now() + (d.maxDurationMs ?? 6 * 60_000);

  const seen = new Set<number>();
  let maxSeq: number | undefined;
  let finalSent = false;
  let live: boolean | null = null;
  let failures = 0;
  let timer: unknown = null;
  let stopped = false;

  const finish = (reason: NarrationStopReason) => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearT(timer);
    timer = null;
    d.onStop?.(reason);
  };

  const tick = async () => {
    timer = null;
    if (stopped) return;
    let res: LenientNarrationResponse;
    try {
      res = await d.fetch(maxSeq);
    } catch (e) {
      if (stopped) return;
      if (isUnsupported(e)) return finish("unsupported");
      if (isForbidden(e)) return finish("forbidden");
      failures++;
      d.onError?.(e);
      return schedule();
    }
    if (stopped) return;
    failures = 0;
    if (live === null) live = !res.done;
    const fresh = res.lines
      .filter((l) => !seen.has(l.seq) && l.text.trim().length > 0)
      .sort((a, b) => a.seq - b.seq);
    for (const l of fresh) {
      seen.add(l.seq);
      maxSeq = maxSeq === undefined ? l.seq : Math.max(maxSeq, l.seq);
    }
    if (fresh.length) d.onLines(fresh, live);
    if (res.final && !finalSent) {
      finalSent = true;
      d.onFinal(res.final, live);
    }
    if (res.done) return finish("done");
    schedule();
  };

  function schedule() {
    if (stopped) return;
    if (now() >= deadline) return finish("timeout");
    const wait = failures ? Math.min(base * 2 ** failures, cap) : base;
    timer = setT(() => void tick(), wait);
  }

  void tick();
  return () => finish("stopped");
}
