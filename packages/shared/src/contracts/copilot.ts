/**
 * "Ask the data": plain-English questions about an OPEN dataset, answered from the same
 * privacy-coarsened public rows /api/public/datasets serves.
 *
 * Safety by construction: the model never writes SQL. It only fills a CopilotPlan from this fixed
 * grammar; the server validates every name against the protocol's public columns and compiles the
 * plan to parameterized SQL (identifiers from a whitelist, every value a bind parameter). A second
 * step writes the answer text grounded only in the computed result (Grokbot grounding).
 *
 * POST /api/copilot/ask          signed-in researchers; may scope to a bounty they own
 * POST /api/public/copilot/ask   no login; public dataset only; stricter rate limits
 */
import { z } from "zod";
import { IsoDate, Uuid } from "./common";
import { GrokbotMessageSchema } from "./grokbot";
import { PublicRowSchema } from "./openData";

export const COPILOT_MAX_LIMIT = 500;
export const COPILOT_MAX_QUESTION = 500;
export const COPILOT_REFUSAL = "I can only answer questions about the published observations in this dataset.";

export const DatasetSlug = z.string().regex(/^[a-z0-9-]{1,80}$/);

export const CopilotFilterOpSchema = z.enum(["eq", "neq", "lt", "lte", "gt", "gte", "in", "is_null", "not_null"]);
export type CopilotFilterOp = z.infer<typeof CopilotFilterOpSchema>;
export const CopilotAggFnSchema = z.enum(["count", "min", "max", "mean", "median", "p90"]);
export type CopilotAggFn = z.infer<typeof CopilotAggFnSchema>;
export const CopilotGroupKindSchema = z.enum(["none", "field", "h3_cell", "hour", "day"]);
export const CopilotChartSchema = z.enum(["bar", "line", "table", "map"]);
export type CopilotChart = z.infer<typeof CopilotChartSchema>;
export const CopilotCoverageSchema = z.enum(["none", "under_target", "met_target", "all"]);
export const QualityTierFilterSchema = z.enum(["human_verified", "model_high"]);

/**
 * The query plan: the ONLY thing the model produces. Flat, all keys required (strict JSON schema),
 * values as strings (the server coerces them per column type). Also shown to the user verbatim.
 */
export const CopilotPlanSchema = z.object({
  /** false = the question is outside the grammar (the server then refuses politely). */
  answerable: z.boolean(),
  dataset: DatasetSlug,
  /** Relative window ending now, or an absolute from/to (ISO 8601). All null = all time. */
  time: z.object({
    since_hours: z.number().int().min(1).max(8784).nullable(),
    from: z.string().max(40).nullable(),
    to: z.string().max(40).nullable(),
  }),
  /** Distance filter around a point (named place: the label is shown to the user with the coordinates). */
  near: z
    .object({
      label: z.string().max(80),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radius_m: z.number().min(10).max(50_000),
    })
    .nullable(),
  /** Only rows captured for this bounty (must be one of the dataset's bounties). */
  bounty_id: Uuid.nullable(),
  quality_tier: QualityTierFilterSchema.nullable(),
  filters: z
    .array(
      z.object({
        field: z.string().max(64),
        op: CopilotFilterOpSchema,
        value: z.string().max(100).nullable(),
        values: z.array(z.string().max(100)).max(20),
      }),
    )
    .max(8),
  group_by: z.object({ kind: CopilotGroupKindSchema, field: z.string().max(64).nullable() }),
  aggregates: z.array(z.object({ fn: CopilotAggFnSchema, field: z.string().max(64).nullable() })).max(6),
  /** Per-cell observation counts vs the bounty's target (signed-in researchers, needs bounty_id). */
  coverage: CopilotCoverageSchema,
  sort: z.object({ by: z.string().max(80), dir: z.enum(["asc", "desc"]) }).nullable(),
  limit: z.number().int().min(1).max(COPILOT_MAX_LIMIT),
  chart: CopilotChartSchema,
});
export type CopilotPlan = z.infer<typeof CopilotPlanSchema>;

export const CopilotAskRequestSchema = z.object({
  question: z.string().trim().min(3).max(COPILOT_MAX_QUESTION),
  /** Defaults to the only / first published dataset. */
  dataset: DatasetSlug.optional(),
  /** Signed-in route only: scope to a bounty the caller owns (still coarsened public rows). */
  bounty_id: Uuid.optional(),
});
export type CopilotAskRequest = z.infer<typeof CopilotAskRequestSchema>;

export const CopilotColumnSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(["number", "string", "datetime", "boolean"]),
});
export type CopilotColumn = z.infer<typeof CopilotColumnSchema>;

export const CopilotResultSchema = z.object({
  columns: z.array(CopilotColumnSchema),
  rows: z.array(PublicRowSchema),
  /** Result rows before the limit (rows or groups). */
  total_rows: z.number().int().min(0),
  truncated: z.boolean(),
  /** Published observations that matched the filters. */
  observations_matched: z.number().int().min(0),
  /** Published observations in scope (dataset, or the bounty) before filters. */
  observations_in_scope: z.number().int().min(0),
});
export type CopilotResult = z.infer<typeof CopilotResultSchema>;

export const CopilotAnswerSchema = z.object({
  status: z.enum(["answered", "refused"]),
  question: z.string(),
  refusal: z.string().nullable(),
  dataset: z.object({ slug: z.string(), name: z.string(), version: z.number().int() }).nullable(),
  plan: CopilotPlanSchema.nullable(),
  /** "How I answered": the plan in plain words, one step per line. */
  plan_steps: z.array(z.string()),
  result: CopilotResultSchema.nullable(),
  answer: GrokbotMessageSchema.nullable(),
  /** Citable methods paragraph (dataset, license, N, filters, coarsening, retrieval date). */
  methods: z.string().nullable(),
  chart: CopilotChartSchema,
  /** Who filled the plan: the model, the mock fixtures, or the plan cache. */
  planner: z.enum(["grok", "mock", "cache", "none"]),
  generated_at: IsoDate,
});
export type CopilotAnswer = z.infer<typeof CopilotAnswerSchema>;
