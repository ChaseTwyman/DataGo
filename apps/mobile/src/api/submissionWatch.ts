/**
 * Watch one submission until it reaches a final status: Supabase realtime when the backend has it,
 * otherwise GET /api/submissions/:id every second (contracts/lists.ts polling fallback). Pure core,
 * timers and transports injected.
 */
import {
  contributorMessage,
  isIntegrityCode,
  NEUTRAL_INTEGRITY_MESSAGE,
  reasonKind,
  type Protocol,
  type ReasonCode,
  type SubmissionRow,
} from "@groundtruth/shared";

export const FINAL_STATUSES = new Set(["accepted", "rejected", "needs_review"]);
export const isFinal = (status: string): boolean => FINAL_STATUSES.has(status);

export interface WatchDeps<T extends { status: string }> {
  fetchOnce: () => Promise<T>;
  /** Returns an unsubscribe function; null when realtime isn't available. */
  subscribe: ((onRow: (row: T) => void) => () => void) | null;
  onUpdate: (row: T) => void;
  onError?: (e: unknown) => void;
  intervalMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

/** Returns a stop function. Always does one GET first (realtime only sends future changes). */
export function watchSubmission<T extends { status: string }>(d: WatchDeps<T>): () => void {
  const setT = d.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = d.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let stopped = false;
  let timer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  let done = false;

  const deliver = (row: T) => {
    if (stopped) return;
    d.onUpdate(row);
    if (isFinal(row.status)) {
      done = true;
      stop();
    }
  };

  const poll = async () => {
    timer = null;
    if (stopped) return;
    try {
      deliver(await d.fetchOnce());
    } catch (e) {
      d.onError?.(e);
    }
    if (!stopped && !done && !unsubscribe) timer = setT(() => void poll(), d.intervalMs ?? 1000);
  };

  function stop() {
    stopped = true;
    if (timer !== null) clearT(timer);
    timer = null;
    unsubscribe?.();
    unsubscribe = null;
  }

  if (d.subscribe) unsubscribe = d.subscribe(deliver);
  void poll();
  return stop;
}

export type ResultKind = "verifying" | "accepted" | "needs_review" | "protocol_reject" | "integrity_reject";

export interface ResultView {
  kind: ResultKind;
  title: string;
  messages: string[];
  retryable: boolean;
}

/**
 * What the contributor sees (PRD §7.5). Integrity rejects show only the neutral message — never
 * which check fired — so the screen can't be used to learn how to beat verification.
 */
export function resultView(
  row: Pick<SubmissionRow, "status" | "reason_codes" | "payout_cents">,
  protocol: Protocol | null,
  opts: { sessionOpen: boolean; serverRetryable?: boolean } = { sessionOpen: false },
): ResultView {
  const codes = row.reason_codes as ReasonCode[];
  const label = (code: ReasonCode) =>
    code.startsWith("MISSING_ELEMENT:")
      ? protocol?.capture.required_elements.find((e) => e.id === code.slice("MISSING_ELEMENT:".length))?.label
      : undefined;
  switch (row.status) {
    case "accepted":
      return {
        kind: "accepted",
        title: "Accepted",
        messages: ["Your reading is now on the city's map.", ...codes.filter((c) => reasonKind(c) === "info").map((c) => contributorMessage(c))],
        retryable: false,
      };
    case "needs_review":
      return { kind: "needs_review", title: "Needs review", messages: ["Looks good. A reviewer will confirm within 24 hours."], retryable: false };
    case "rejected": {
      if (codes.some(isIntegrityCode) || codes.length === 0) {
        return { kind: "integrity_reject", title: "Not verified", messages: [NEUTRAL_INTEGRITY_MESSAGE], retryable: false };
      }
      const msgs = [...new Set(codes.filter((c) => reasonKind(c) !== "info").map((c) => contributorMessage(c, label(c))))];
      return {
        kind: "protocol_reject",
        title: "Let's fix the shot",
        messages: msgs.length ? msgs : ["The capture didn't meet the protocol."],
        retryable: opts.sessionOpen && (opts.serverRetryable ?? true),
      };
    }
    default:
      return { kind: "verifying", title: "Verifying…", messages: [], retryable: false };
  }
}
