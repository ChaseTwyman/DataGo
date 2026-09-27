import { z } from "zod";

/** A JSON Schema fragment. Kept loose on purpose: protocols ship arbitrary extraction schemas. */
export type JsonSchema = { [key: string]: unknown };

const JsonSchemaObject = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.record(z.string(), z.unknown())),
    required: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * `optional: true` marks a secondary element (nice to have, e.g. a scale object beside a product):
 * it is still coached and checked, but its absence only lowers confidence (decide(): OPTIONAL_ELEMENT_PENALTY)
 * and never rejects or blocks the live capture gate. Omitted = required, the original behaviour.
 * Chosen over a `priority` enum: one boolean covers the need and keeps old protocols valid unchanged.
 */
export const RequiredElementSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  description: z.string().min(1),
  optional: z.boolean().optional(),
});

/** Ids of the protocol's optional (secondary) elements. */
export function optionalElementIds(protocol: Protocol): string[] {
  return protocol.capture.required_elements.filter((e) => e.optional === true).map((e) => e.id);
}

/** True when the protocol is captured indoors: outdoor-only context checks (daylight) do not apply. */
export function isIndoorProtocol(protocol: Protocol): boolean {
  return protocol.capture.setting === "indoor";
}

export const ChallengeSchema = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  expect: z.string().min(1),
});

export const FieldQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    question: z.string().min(1),
    type: z.literal("enum"),
    options: z.array(z.string()).min(1),
  }),
  z.object({ id: z.string().min(1), question: z.string().min(1), type: z.literal("boolean") }),
  z.object({ id: z.string().min(1), question: z.string().min(1), type: z.literal("number") }),
  z.object({ id: z.string().min(1), question: z.string().min(1), type: z.literal("text") }),
]);

/**
 * Plausibility rules for the model's extraction (packages/shared/src/extractionSanity.ts), so each
 * protocol states its own sanity bounds as data:
 *   required_number — field must be a number (≥ min if given), else EXTRACTION_MISSING (retryable reject)
 *   max_relative    — field ≤ reference_field × factor, else EXTRACTION_IMPLAUSIBLE (review cap);
 *                     skipped when the reference value is absent
 *   min_confidence  — field ≥ min, else EXTRACTION_LOW_CONFIDENCE (review cap)
 */
export const ExtractionRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("required_number"), field: z.string().min(1), min: z.number().optional() }),
  z.object({
    kind: z.literal("max_relative"),
    field: z.string().min(1),
    reference_field: z.string().min(1),
    factor: z.number().positive(),
  }),
  z.object({ kind: z.literal("min_confidence"), field: z.string().min(1), min: z.number().min(0).max(1) }),
]);
export type ExtractionRule = z.infer<typeof ExtractionRuleSchema>;

/**
 * Revisit schedule. `intervals_min`: minutes after the original capture each follow-up is due;
 * `max`: at most this many missions per original reading; `first_dibs_min`: the original contributor
 * alone may fill a mission for this long after it opens; `window_min`: a mission stays open this long
 * after it is due (it opens `early_min` before).
 */
export const RevisitConfigSchema = z.object({
  intervals_min: z.array(z.number().int().min(5).max(24 * 60)).min(1).max(6),
  max: z.number().int().min(1).max(6),
  first_dibs_min: z.number().int().min(0).max(120).optional(),
  window_min: z.number().int().min(5).max(180).optional(),
  early_min: z.number().int().min(0).max(30).optional(),
});
export type RevisitConfig = z.infer<typeof RevisitConfigSchema>;

export const ProtocolSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().positive(),
  name: z.string().min(1),
  why_it_matters: z.string().min(1),
  safety: z.object({
    level: z.enum(["low", "normal", "elevated", "high"]),
    check_in_question: z.string().min(1),
    rules: z.array(z.string()).min(1),
  }),
  capture: z.object({
    mode: z.enum(["burst", "single"]),
    frames: z.number().int().min(1).max(6),
    frame_interval_ms: z.number().int().min(100).max(3000),
    /**
     * Coaching preference only: the verifier never penalises portrait vs landscape (the phone's
     * EXIF rotation decides how a frame is stored; contributors hold the phone either way).
     */
    orientation: z.enum(["landscape", "portrait", "any"]),
    /**
     * Where captures happen. "indoor" skips outdoor-only context checks (daylight vs sun position:
     * a packaged-goods photo under a lamp at 1 am is not a mismatch). Omitted = "outdoor".
     */
    setting: z.enum(["outdoor", "indoor"]).optional(),
    max_tilt_deg: z.number().min(1).max(90),
    required_elements: z.array(RequiredElementSchema).min(1),
    framing_tips: z.array(z.string()),
    challenges: z.array(ChallengeSchema).min(1),
    field_questions: z.array(FieldQuestionSchema),
  }),
  extraction_schema: JsonSchemaObject,
  acceptance: z.object({
    min_protocol_score: z.number().min(0).max(1),
    min_authenticity_score: z.number().min(0).max(1),
    precipitation_plausibility: z
      .object({ lookback_hours: z.number().positive(), min_total_mm: z.number().min(0) })
      .nullable()
      .optional(),
    corroboration_radius_m: z.number().positive(),
    corroboration_window_min: z.number().positive(),
    /** Numeric extraction field compared for corroboration (flood: depth_cm). */
    corroboration_field: z.string().optional(),
    corroboration_tolerance: z.number().positive().optional(),
    /** Extraction plausibility rules (optional; none → no extraction sanity checks). */
    extraction_rules: z.array(ExtractionRuleSchema).optional(),
    /**
     * A required element the model says is absent with at least this confidence is a hard protocol
     * reject (retryable), even if another stage errored. Default ELEMENT_ABSENT_CONFIDENCE (0.8).
     */
    element_absent_reject_confidence: z.number().min(0).max(1).optional(),
  }),
  pricing: z.object({ urgency_tau_hours: z.number().positive() }).optional(),
  /**
   * Revisit missions (optional; see contracts/missions.ts): when a reading is accepted, follow-up
   * missions for the same H3 cell open at each interval after the capture (e.g. flood recession).
   */
  revisit: RevisitConfigSchema.optional(),
  example_image_prompt: z.string().min(1),
});

export type Protocol = z.infer<typeof ProtocolSchema>;
export type RequiredElement = z.infer<typeof RequiredElementSchema>;
export type Challenge = z.infer<typeof ChallengeSchema>;
export type FieldQuestion = z.infer<typeof FieldQuestionSchema>;

export const DEFAULT_URGENCY_TAU_HOURS = 3;

export function urgencyTauHours(protocol: Protocol): number {
  return protocol.pricing?.urgency_tau_hours ?? DEFAULT_URGENCY_TAU_HOURS;
}

/** Pick a random challenge. `rand` is injectable for deterministic tests. */
export function pickChallenge(protocol: Protocol, rand: () => number = Math.random): Challenge {
  const pool = protocol.capture.challenges;
  const idx = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  const c = pool[idx];
  if (!c) throw new Error("protocol has no challenges");
  return c;
}
