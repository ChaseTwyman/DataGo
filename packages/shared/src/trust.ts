/** Trust score updates, PRD §9.3. */
import type { DecisionStatus } from "./decision";

export const TRUST_START = 0.5;
export const TRUST_CAP = 0.95;
export const TRUST_ACCEPT_DELTA = 0.02;
export const TRUST_PROTOCOL_REJECT_DELTA = -0.05;
export const TRUST_INTEGRITY_REJECT_DELTA = -0.25;

export type TrustEvent =
  | { kind: "accepted" }
  | { kind: "rejected"; rejectionKind: "integrity" | "protocol" | "context" | null }
  | { kind: "needs_review" }
  | { kind: "review_approved" }
  | { kind: "review_rejected"; integrity: boolean };

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number) => Math.min(TRUST_CAP, Math.max(0, v));

export function trustDelta(e: TrustEvent): number {
  switch (e.kind) {
    case "accepted":
    case "review_approved":
      return TRUST_ACCEPT_DELTA;
    case "needs_review":
      return 0;
    case "rejected":
      return e.rejectionKind === "integrity"
        ? TRUST_INTEGRITY_REJECT_DELTA
        : TRUST_PROTOCOL_REJECT_DELTA;
    case "review_rejected":
      return e.integrity ? TRUST_INTEGRITY_REJECT_DELTA : TRUST_PROTOCOL_REJECT_DELTA;
  }
}

export function updateTrust(score: number, e: TrustEvent): number {
  return round3(clamp(score + trustDelta(e)));
}

export function trustEventFor(status: DecisionStatus, rejectionKind: "integrity" | "protocol" | "context" | null): TrustEvent {
  if (status === "accepted") return { kind: "accepted" };
  if (status === "needs_review") return { kind: "needs_review" };
  return { kind: "rejected", rejectionKind };
}
