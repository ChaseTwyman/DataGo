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

export const RequiredElementSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  description: z.string().min(1),
});

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
    orientation: z.enum(["landscape", "portrait", "any"]),
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
  }),
  pricing: z.object({ urgency_tau_hours: z.number().positive() }).optional(),
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
