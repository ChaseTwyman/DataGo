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
  // Verification hardening (vitamin-water incident).
  // Fast relevance check: the frames are not a scene of the protocol subject at all.
  "OFF_TOPIC",
  // The server never recorded GATE_REQUIRED_GREEN consecutive all-green frame checks for the session.
  "GATE_NOT_PASSED",
  // Extraction sanity (per-protocol plausibility rules).
  "EXTRACTION_MISSING",
  "EXTRACTION_IMPLAUSIBLE",
  "EXTRACTION_LOW_CONFIDENCE",
  // Near-identical to an earlier reading of the same cell taken one revisit interval earlier
  // (a genuine +30/+60/+120 min revisit with the same framing). Review, never an accusation.
  "REVISIT_SIMILAR",
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
  OFF_TOPIC: "protocol",
  EXTRACTION_MISSING: "protocol",
  OUTSIDE_AREA: "context",
  OUTSIDE_WINDOW: "context",
  WEATHER_IMPLAUSIBLE: "context",
  DAYLIGHT_MISMATCH: "context",
  HAZARD_PAUSED: "context",
  LOW_TRUST_REVIEW: "review",
  STAGE_ERROR: "review",
  REVIEWER_REJECTED: "review",
  BUDGET_EXHAUSTED: "review",
  GATE_NOT_PASSED: "review",
  EXTRACTION_IMPLAUSIBLE: "review",
  EXTRACTION_LOW_CONFIDENCE: "review",
  REVISIT_SIMILAR: "review",
  DEMO_WAIVER: "info",
  GATE_DEGRADED: "info",
};

export const isKnownReasonCode = (code: string): code is ReasonCode => ReasonCodeSchema.safeParse(code).success;

/**
 * Category of a reason code. Codes this build doesn't know (sent by a newer server) are "review":
 * neutral, never an integrity accusation, never a retry hint.
 */
export function reasonKind(code: ReasonCode | (string & {})): ReasonKind {
  if (code.startsWith("MISSING_ELEMENT:")) return "protocol";
  return KIND[code as FixedReasonCode] ?? "review";
}

export const isIntegrityCode = (code: ReasonCode | (string & {})): boolean => reasonKind(code) === "integrity";

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
  OFF_TOPIC: "This doesn't look like the scene this bounty asks for. Point the camera at the subject in the briefing and try again.",
  EXTRACTION_MISSING: "We couldn't take a measurement from these photos. Frame the scene as shown in the briefing and try again.",
  GATE_NOT_PASSED: "A reviewer will take a look.",
  EXTRACTION_IMPLAUSIBLE: "A reviewer will take a look.",
  EXTRACTION_LOW_CONFIDENCE: "A reviewer will take a look.",
  REVISIT_SIMILAR: "A reviewer will take a look.",
  REVIEWER_REJECTED: "A reviewer couldn't accept this capture.",
  GATE_DEGRADED: "The live scene check ran in limited mode.",
};

/** Subset of a protocol needed to tell a contributor what the bounty expected. */
export interface ProtocolSubject {
  name: string;
  capture: { required_elements: { label: string }[] };
}

export function contributorMessage(code: ReasonCode | (string & {}), elementLabel?: string, protocol?: ProtocolSubject): string {
  // A code this build doesn't know (newer server): neutral wording, no guess at the cause.
  if (!isKnownReasonCode(code)) return NEUTRAL_INTEGRITY_MESSAGE;
  if (isIntegrityCode(code)) return NEUTRAL_INTEGRITY_MESSAGE;
  if (code === "OFF_TOPIC" && protocol) {
    // An honest contributor may simply have mis-aimed: say what was expected (not which check fired).
    const want = protocol.capture.required_elements.map((e) => e.label.toLowerCase()).join(", ");
    return `This doesn't look like a ${protocol.name.toLowerCase()} scene. Point the camera at: ${want}.`;
  }
  if (code.startsWith("MISSING_ELEMENT:")) {
    return `Missing from the shot: ${elementLabel ?? code.slice("MISSING_ELEMENT:".length)}.`;
  }
  return CONTRIBUTOR_TEXT[code as FixedReasonCode] ?? NEUTRAL_INTEGRITY_MESSAGE;
}
