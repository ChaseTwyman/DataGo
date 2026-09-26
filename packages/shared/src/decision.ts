/** Decision rules, PRD §9.3. Pure: the pipeline gathers signals, this decides. */
import type { StageResult } from "./checks";
import { payoutMultiplier } from "./pricing";
import { reasonKind, type ReasonCode } from "./reasonCodes";

export type SubmissionStatus = "pending" | "verifying" | "accepted" | "rejected" | "needs_review";
export type DecisionStatus = "accepted" | "rejected" | "needs_review";

export interface Suspicion {
  suspected: boolean;
  confidence: number;
}

export interface DecisionInput {
  stages: StageResult[];
  /** 0..1 from the verification model. */
  protocolScore: number;
  authenticityScore: number;
  /** 0..1 context plausibility (area, weather, daylight). */
  contextScore: number;
  /** 0..1 agreement with nearby accepted observations; 0.5 when there are none. */
  corroborationScore: number;
  trustScore: number;
  minProtocolScore: number;
  minAuthenticityScore: number;
  authenticity?: {
    screen_recapture?: Suspicion;
    printed_photo?: Suspicion;
    ai_generated?: Suspicion;
    edited_or_composited?: Suspicion;
  };
}

export interface Decision {
  status: DecisionStatus;
  confidence: number;
  reasonCodes: ReasonCode[];
  payoutMultiplier: number;
  /** Protocol-quality rejections may be retried within the session; integrity ones may not. */
  retryable: boolean;
  rejectionKind: "integrity" | "protocol" | "context" | null;
}

export const WEIGHTS = { protocol: 0.35, authenticity: 0.35, context: 0.15, reputation: 0.15 };
export const ACCEPT_AT = 0.75;
export const REVIEW_AT = 0.5;
export const LOW_TRUST = 0.3;
export const AUTH_HARD_FAIL_CONFIDENCE = 0.8;

/** Codes that reject outright, whatever the scores. */
const HARD_FAIL: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "SESSION_INVALID",
  "SESSION_EXPIRED",
  "OUTSIDE_AREA",
  "OUTSIDE_WINDOW",
  "DUPLICATE",
  "CHALLENGE_FAILED",
  "SYNTHETIC_MEDIA",
  "C2PA_AI_GENERATED",
]);

/** Codes that can never be auto-accepted; they cap the result at needs_review. */
const REVIEW_CAP: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "VELOCITY_LIMIT",
  "IMPOSSIBLE_TRAVEL",
  "STAGE_ERROR",
]);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function blendConfidence(i: DecisionInput): number {
  const reputation = 0.5 * clamp01(i.trustScore) + 0.5 * clamp01(i.corroborationScore);
  return round3(
    WEIGHTS.protocol * clamp01(i.protocolScore) +
      WEIGHTS.authenticity * clamp01(i.authenticityScore) +
      WEIGHTS.context * clamp01(i.contextScore) +
      WEIGHTS.reputation * reputation,
  );
}

function uniq(codes: ReasonCode[]): ReasonCode[] {
  return [...new Set(codes)];
}

export function decide(input: DecisionInput): Decision {
  const codes: ReasonCode[] = input.stages.flatMap((s) => s.reasonCodes);
  const confidence = blendConfidence(input);
  const multiplier = payoutMultiplier(input.protocolScore);

  // Authenticity: recapture / print / AI at >= 0.8 confidence are hard fails; weaker suspicion caps at review.
  let authReviewCap = false;
  const a = input.authenticity ?? {};
  const authMap: [Suspicion | undefined, ReasonCode, boolean][] = [
    [a.screen_recapture, "SCREEN_RECAPTURE", true],
    [a.printed_photo, "PRINTED_PHOTO", true],
    [a.ai_generated, "AI_GENERATED_SUSPECTED", true],
    [a.edited_or_composited, "EDITED_SUSPECTED", false],
  ];
  const authHard: ReasonCode[] = [];
  for (const [s, code, canHardFail] of authMap) {
    if (!s?.suspected) continue;
    codes.push(code);
    if (canHardFail && s.confidence >= AUTH_HARD_FAIL_CONFIDENCE) authHard.push(code);
    else authReviewCap = true;
  }

  const hard = uniq([...codes.filter((c) => HARD_FAIL.has(c)), ...authHard]);
  if (hard.length > 0) {
    const onlyContext = hard.every((c) => reasonKind(c) === "context");
    return {
      status: "rejected",
      confidence,
      reasonCodes: uniq(codes),
      payoutMultiplier: 0,
      retryable: false,
      rejectionKind: onlyContext ? "context" : "integrity",
    };
  }

  // A stage that errored never auto-accepts.
  const errored = input.stages.some((s) => s.status === "error");
  if (errored) codes.push("STAGE_ERROR");

  // Protocol failure: missing element or protocol score below the protocol minimum -> retryable reject.
  const missing = codes.some((c) => c.startsWith("MISSING_ELEMENT:"));
  if (!errored && (missing || input.protocolScore < input.minProtocolScore)) {
    if (!missing && !codes.some((c) => reasonKind(c) === "protocol")) codes.push("LOW_CONFIDENCE");
    return {
      status: "rejected",
      confidence,
      reasonCodes: uniq(codes),
      payoutMultiplier: 0,
      retryable: true,
      rejectionKind: "protocol",
    };
  }

  const capped =
    errored ||
    authReviewCap ||
    codes.some((c) => REVIEW_CAP.has(c)) ||
    input.authenticityScore < input.minAuthenticityScore;

  let status: DecisionStatus;
  if (confidence < REVIEW_AT && !errored) status = "rejected";
  else if (confidence >= ACCEPT_AT && !capped && input.trustScore >= LOW_TRUST) status = "accepted";
  else status = "needs_review";

  if (status === "needs_review" && input.trustScore < LOW_TRUST) codes.push("LOW_TRUST_REVIEW");
  if (status === "rejected" && !codes.some((c) => reasonKind(c) === "protocol")) {
    codes.push("LOW_CONFIDENCE");
  }

  return {
    status,
    confidence,
    reasonCodes: uniq(codes),
    payoutMultiplier: status === "rejected" ? 0 : multiplier,
    retryable: status === "rejected",
    rejectionKind: status === "rejected" ? "protocol" : null,
  };
}
