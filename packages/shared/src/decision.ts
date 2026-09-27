/** Decision rules, PRD §9.3. Pure: the pipeline gathers signals, this decides. */
import type { StageResult } from "./checks";
import { payoutMultiplier } from "./pricing";
import { missingElement, reasonKind, type ReasonCode } from "./reasonCodes";

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
  /** Model element verdicts: a confident "absent" is a hard protocol reject (see ELEMENT_ABSENT_CONFIDENCE). */
  elements?: { id: string; present: boolean; confidence: number }[];
  /** Protocol override of ELEMENT_ABSENT_CONFIDENCE (acceptance.element_absent_reject_confidence). */
  elementAbsentConfidence?: number;
  /**
   * Ids of required elements the protocol marks `optional` (secondary, e.g. a scale object). Missing
   * ones cost OPTIONAL_ELEMENT_PENALTY confidence each instead of rejecting.
   */
  optionalElements?: string[];
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
/** A required element the model calls absent with at least this confidence rejects (retryable). */
export const ELEMENT_ABSENT_CONFIDENCE = 0.8;

/**
 * The motion challenge is a soft liveness signal. Real, authentic captures of a static indoor subject
 * were rejected because the model judged a ~1.4 s burst "near-identical" (cashew test, 2026-09-27).
 * CHALLENGE_FAILED alone now only costs this much confidence; it still rejects (integrity) when it
 * co-occurs with an authenticity concern (see authenticityConcern), which is where it adds evidence.
 */
export const CHALLENGE_SOFT_PENALTY = 0.03;
/** Confidence cost per missing `optional` (secondary) element, e.g. no scale object beside the jar. */
export const OPTIONAL_ELEMENT_PENALTY = 0.03;
/**
 * Challenge-stage subcheck id for the model-independent "burst frames are perceptually identical"
 * signal (one image submitted N times). That is stronger than the model's judgment: never auto-accepted.
 */
export const STATIC_BURST_SUBCHECK = "burst_motion";

/** Codes that reject outright, whatever the scores. CHALLENGE_FAILED is conditional (see decide). */
const HARD_FAIL: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "SESSION_INVALID",
  "SESSION_EXPIRED",
  "OUTSIDE_AREA",
  "OUTSIDE_WINDOW",
  "DUPLICATE",
  "SYNTHETIC_MEDIA",
  "C2PA_AI_GENERATED",
]);

/** Codes that, next to a failed challenge, make the capture look staged rather than just static. */
const AUTH_CONCERN: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "SCREEN_RECAPTURE",
  "PRINTED_PHOTO",
  "AI_GENERATED_SUSPECTED",
  "EDITED_SUSPECTED",
  "C2PA_AI_GENERATED",
  "DUPLICATE",
  "SYNTHETIC_MEDIA",
]);

/** Codes that can never be auto-accepted; they cap the result at needs_review. */
const REVIEW_CAP: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "VELOCITY_LIMIT",
  "IMPOSSIBLE_TRAVEL",
  "STAGE_ERROR",
  // The server never saw the capture gate pass: never auto-accepted, never auto-paid (incident fix).
  "GATE_NOT_PASSED",
  // The phone says its gate ran on device checks only. A client claim can never unlock payment.
  "GATE_DEGRADED",
  "EXTRACTION_IMPLAUSIBLE",
  "EXTRACTION_LOW_CONFIDENCE",
  // Looks like an earlier reading of the same spot one revisit interval ago: a human confirms it.
  "REVISIT_SIMILAR",
]);

const isOptionalMissing = (c: ReasonCode, optional: ReadonlySet<string>) =>
  c.startsWith("MISSING_ELEMENT:") && optional.has(c.slice("MISSING_ELEMENT:".length));

/**
 * Protocol failures that reject (retryable) even when another stage errored: the capture is
 * unusable whatever the rest of the pipeline would have said.
 */
const HARD_PROTOCOL: ReadonlySet<ReasonCode> = new Set<ReasonCode>(["OFF_TOPIC", "EXTRACTION_MISSING"]);

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
  const optional = new Set(input.optionalElements ?? []);
  const multiplier = payoutMultiplier(input.protocolScore);

  // Soft signals: a failed motion challenge and missing optional elements only cost confidence.
  const challengeFailed = codes.includes("CHALLENGE_FAILED");
  const optionalMissing = new Set(codes.filter((c) => isOptionalMissing(c, optional)));
  for (const e of input.elements ?? []) {
    if (!e.present && optional.has(e.id)) optionalMissing.add(missingElement(e.id));
  }
  const penalty = (challengeFailed ? CHALLENGE_SOFT_PENALTY : 0) + OPTIONAL_ELEMENT_PENALTY * optionalMissing.size;
  const confidence = round3(Math.max(0, blendConfidence(input) - penalty));

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

  // A failed challenge next to any authenticity concern is the staged-capture pattern: reject as before.
  const authenticityConcern =
    codes.some((c) => AUTH_CONCERN.has(c)) ||
    input.stages.some((s) => s.stage === "authenticity" && s.status === "fail") ||
    input.authenticityScore < input.minAuthenticityScore;
  const challengeHard: ReasonCode[] = challengeFailed && authenticityConcern ? ["CHALLENGE_FAILED"] : [];
  // One image submitted N times (identical burst): never auto-accepted, whatever the model thought.
  const staticBurst = input.stages.some(
    (s) => s.stage === "challenge" && (s.subchecks ?? []).some((x) => x.id === STATIC_BURST_SUBCHECK && x.status === "fail"),
  );

  const hard = uniq([...codes.filter((c) => HARD_FAIL.has(c)), ...authHard, ...challengeHard]);
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

  // Wrong subject, no usable measurement, or a required element confidently absent: reject
  // (retryable: an honest contributor may have mis-aimed), even if a model stage errored.
  // Optional (secondary) elements never reject; they were priced into `confidence` above.
  const absentAt = input.elementAbsentConfidence ?? ELEMENT_ABSENT_CONFIDENCE;
  codes.push(...optionalMissing);
  const absent = (input.elements ?? []).filter((e) => !e.present && e.confidence >= absentAt && !optional.has(e.id));
  for (const e of absent) codes.push(missingElement(e.id));
  const confidentlyAbsent = absent.length > 0;
  if (confidentlyAbsent || codes.some((c) => HARD_PROTOCOL.has(c))) {
    return {
      status: "rejected",
      confidence,
      reasonCodes: uniq(codes),
      payoutMultiplier: 0,
      retryable: true,
      rejectionKind: "protocol",
    };
  }

  // A stage that errored never auto-accepts.
  const errored = input.stages.some((s) => s.status === "error");
  if (errored) codes.push("STAGE_ERROR");

  // Protocol failure: missing element or protocol score below the protocol minimum -> retryable reject.
  const missing = codes.some((c) => c.startsWith("MISSING_ELEMENT:") && !isOptionalMissing(c, optional));
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
    staticBurst ||
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
