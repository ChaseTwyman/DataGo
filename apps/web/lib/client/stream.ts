/**
 * Pure state for the live submission stream. The realtime path and the polling path both feed full
 * fetched lists into this reducer, so the UI behaves identically either way.
 */
import type { LenientSubmissionWithMedia as SubmissionWithMedia } from "@groundtruth/shared";

export type StreamMode = "realtime" | "polling";

export interface StreamState {
  submissions: SubmissionWithMedia[];
  loading: boolean;
  error: string | null;
  /** Ids that appeared since the previous load (not on the first load) — used to highlight arrivals. */
  freshIds: string[];
  loadedOnce: boolean;
  updatedAt: number | null;
}

export type StreamAction =
  | { type: "loaded"; submissions: SubmissionWithMedia[]; at: number }
  | { type: "error"; message: string }
  | { type: "remove"; id: string }
  | { type: "reset" };

export const initialStreamState: StreamState = {
  submissions: [],
  loading: true,
  error: null,
  freshIds: [],
  loadedOnce: false,
  updatedAt: null,
};

const byReceivedDesc = (a: SubmissionWithMedia, b: SubmissionWithMedia) =>
  b.received_at.localeCompare(a.received_at) || b.id.localeCompare(a.id);

/** Signature of the fields that change while a submission is verified; media_urls rotate, so skip them. */
function sig(s: SubmissionWithMedia): string {
  return JSON.stringify([s.status, s.checks, s.reason_codes, s.confidence, s.payout_cents, s.extracted]);
}

/**
 * Replace the list with the freshly fetched one (it is authoritative for the current filter) while
 * reusing previous object identities for unchanged rows, so expanded rows don't flicker.
 */
export function mergeSubmissions(prev: SubmissionWithMedia[], next: SubmissionWithMedia[]): SubmissionWithMedia[] {
  const old = new Map(prev.map((s) => [s.id, s]));
  const merged = next.map((s) => {
    const o = old.get(s.id);
    return o && sig(o) === sig(s) ? o : s;
  });
  merged.sort(byReceivedDesc);
  const same = merged.length === prev.length && merged.every((s, i) => s === prev[i]);
  return same ? prev : merged;
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "loaded": {
      const submissions = mergeSubmissions(state.submissions, action.submissions);
      const known = new Set(state.submissions.map((s) => s.id));
      const freshIds = state.loadedOnce ? submissions.filter((s) => !known.has(s.id)).map((s) => s.id) : [];
      if (submissions === state.submissions && !state.loading && state.error === null && freshIds.length === 0) {
        return state.freshIds.length === 0 ? state : { ...state, freshIds: [] };
      }
      return { submissions, loading: false, error: null, freshIds, loadedOnce: true, updatedAt: action.at };
    }
    case "error":
      return { ...state, loading: false, error: action.message };
    case "remove":
      return { ...state, submissions: state.submissions.filter((s) => s.id !== action.id) };
    case "reset":
      return initialStreamState;
  }
}

export type HealthState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; realtime: boolean; backend: string };

/**
 * Realtime only when the server says it is on, the backend is Supabase, and this browser has a
 * Supabase client. Anything else (including a failed health check) polls. `null` = still deciding.
 */
export function chooseStreamMode(health: HealthState, supabaseConfigured: boolean): StreamMode | null {
  if (health.status === "loading") return null;
  if (health.status === "error") return "polling";
  return health.realtime && health.backend === "supabase" && supabaseConfigured ? "realtime" : "polling";
}

export const POLL_INTERVAL_MS = 2000;
/** Safety-net refresh while on realtime, in case an event is missed. */
export const REALTIME_BACKSTOP_MS = 15000;
