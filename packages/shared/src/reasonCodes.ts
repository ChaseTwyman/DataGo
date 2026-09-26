import { z } from "zod";

/** Fixed reason codes (PRD §9.3) plus a few operational ones. `MISSING_ELEMENT:<id>` is templated. */
export const FIXED_REASON_CODES = [
  "SESSION_INVALID",
  "SESSION_EXPIRED",
  "OUTSIDE_AREA",
  "CHALLENGE_FAILED",
  "BLURRY",
  "TOO_DARK",
  "BAD_FRAMING",
  "SCREEN_RECAPTURE",
  "PRINTED_PHOTO",
  "AI_GENERATED_SUSPECTED",
  "EDITED_SUSPECTED",
  "DUPLICATE",
  "VELOCITY_LIMIT",
  "IMPOSSIBLE_TRAVEL",
  "WEATHER_IMPLAUSIBLE",
  "DAYLIGHT_MISMATCH",
  "LOW_TRUST_REVIEW",
  // operational
  "LOW_CONFIDENCE",
  "STAGE_ERROR",
  "SYNTHETIC_MEDIA",
  // Provenance metadata (C2PA / IPTC) declares the image AI-generated.
  "C2PA_AI_GENERATED",
  "DEMO_WAIVER",
  "GATE_DEGRADED",
  "HAZARD_PAUSED",
  "REVIEWER_REJECTED",
  "BUDGET_EXHAUSTED",
  "OUTSIDE_WINDOW",
] as const;

export type FixedReasonCode = (typeof FIXED_REASON_CODES)[number];
export type MissingElementCode = `MISSING_ELEMENT:${string}`;
export type ReasonCode = FixedReasonCode | MissingElementCode;

export const ReasonCodeSchema = z.union([
  z.enum(FIXED_REASON_CODES),
  z.custom<MissingElementCode>(
    (v) => typeof v === "string" && /^MISSING_ELEMENT:[a-z][a-z0-9_]*$/.test(v),
  ),
]);

export const missingElement = (id: string): MissingElementCode => `MISSING_ELEMENT:${id}`;

export type ReasonKind = "integrity" | "protocol" | "context" | "review" | "info";

const KIND: Record<FixedReasonCode, ReasonKind> = {
  SESSION_INVALID: "integrity",
  SESSION_EXPIRED: "integrity",
  CHALLENGE_FAILED: "integrity",
  SCREEN_RECAPTURE: "integrity",
  PRINTED_PHOTO: "integrity",
  AI_GENERATED_SUSPECTED: "integrity",
  EDITED_SUSPECTED: "integrity",
  DUPLICATE: "integrity",
  VELOCITY_LIMIT: "integrity",
  IMPOSSIBLE_TRAVEL: "integrity",
  SYNTHETIC_MEDIA: "integrity",
  C2PA_AI_GENERATED: "integrity",
  BLURRY: "protocol",
  TOO_DARK: "protocol",
  BAD_FRAMING: "protocol",
  LOW_CONFIDENCE: "protocol",
  OUTSIDE_AREA: "context",
  OUTSIDE_WINDOW: "context",
  WEATHER_IMPLAUSIBLE: "context",
  DAYLIGHT_MISMATCH: "context",
  HAZARD_PAUSED: "context",
  LOW_TRUST_REVIEW: "review",
  STAGE_ERROR: "review",
  REVIEWER_REJECTED: "review",
  BUDGET_EXHAUSTED: "review",
  DEMO_WAIVER: "info",
  GATE_DEGRADED: "info",
};

export function reasonKind(code: ReasonCode): ReasonKind {
  if (code.startsWith("MISSING_ELEMENT:")) return "protocol";
  return KIND[code as FixedReasonCode];
}

export const isIntegrityCode = (code: ReasonCode): boolean => reasonKind(code) === "integrity";

/**
 * Contributor-facing text. Integrity failures get one neutral message with no hints (PRD §7.5):
 * telling a cheater which check caught them teaches them to beat it.
 */
export const NEUTRAL_INTEGRITY_MESSAGE = "We couldn't verify this capture.";

const CONTRIBUTOR_TEXT: Partial<Record<FixedReasonCode, string>> = {
  BLURRY: "The photo was blurry. Hold the phone steady and try again.",
  TOO_DARK: "The photo was too dark. Find better light or use a brighter angle.",
  BAD_FRAMING: "The subject wasn't framed well. Center the reference object.",
  LOW_CONFIDENCE: "We couldn't read the scene clearly enough. Try a clearer angle.",
  OUTSIDE_AREA: "This capture was outside the bounty area.",
  OUTSIDE_WINDOW: "This capture was outside the bounty time window.",
  WEATHER_IMPLAUSIBLE: "Recent weather at this spot doesn't match the observation.",
  DAYLIGHT_MISMATCH: "The lighting doesn't match the time of day at this location.",
  HAZARD_PAUSED: "Captures are paused here because of an active hazard warning.",
  LOW_TRUST_REVIEW: "A reviewer will take a look.",
  STAGE_ERROR: "A reviewer will take a look.",
  DEMO_WAIVER: "Weather check waived (demo).",
  BUDGET_EXHAUSTED: "This bounty ran out of budget. A reviewer will take a look.",
};

export function contributorMessage(code: ReasonCode, elementLabel?: string): string {
  if (isIntegrityCode(code)) return NEUTRAL_INTEGRITY_MESSAGE;
  if (code.startsWith("MISSING_ELEMENT:")) {
    return `Missing from the shot: ${elementLabel ?? code.slice("MISSING_ELEMENT:".length)}.`;
  }
  return CONTRIBUTOR_TEXT[code as FixedReasonCode] ?? "See details.";
}
