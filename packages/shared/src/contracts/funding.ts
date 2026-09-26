/**
 * Sponsor pool + pricing preview contracts (migration 000007). Money is simulated, integer cents.
 * Sponsors contribute to a pool (optionally earmarked); the platform's allocation engine funds
 * researcher data requests from it; the platform's pricing engine sets every price.
 */
import { z } from "zod";
import { CellPriceSchema, PolygonSchema } from "./bounties";
import { IsoDate, Lat, Lng, Uuid } from "./common";

const HttpUrl = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine((u) => /^https?:\/\//i.test(u), { message: "Must be an http(s) link" });
const Cents = z.number().int();

// ---------- sponsors (admin) ----------

export const SponsorSchema = z.object({
  id: Uuid,
  name: z.string(),
  url: z.string().nullable(),
  logo_url: z.string().nullable(),
  active: z.boolean(),
  created_at: IsoDate,
  /** Net of reversals. */
  contributed_cents: Cents,
});
export type Sponsor = z.infer<typeof SponsorSchema>;

export const CreateSponsorRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: HttpUrl.nullable().default(null),
  logo_url: HttpUrl.nullable().default(null),
  active: z.boolean().default(true),
});
export const PatchSponsorRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: HttpUrl.nullable().optional(),
  logo_url: HttpUrl.nullable().optional(),
  active: z.boolean().optional(),
});
export type PatchSponsorRequest = z.infer<typeof PatchSponsorRequestSchema>;

// ---------- contributions (admin, append-only) ----------

/** Up to $1M per entry: typos are corrected with a reversal, so keep the blast radius bounded. */
export const MAX_CONTRIBUTION_CENTS = 100_000_000;

export const CreateContributionRequestSchema = z
  .object({
    sponsor_id: Uuid,
    amount_cents: z.number().int().min(1).max(MAX_CONTRIBUTION_CENTS),
    /** Earmarks (all optional; none = general pool). */
    protocol_slug: z.string().trim().min(1).max(120).nullable().default(null),
    region_center_lat: Lat.nullable().default(null),
    region_center_lng: Lng.nullable().default(null),
    region_radius_m: z.number().positive().max(500_000).nullable().default(null),
    region_polygon: PolygonSchema.nullable().default(null),
    bounty_id: Uuid.nullable().default(null),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .refine(
    (c) =>
      (c.region_center_lat === null) === (c.region_center_lng === null) && (c.region_center_lat === null) === (c.region_radius_m === null),
    { message: "Region needs a center latitude, longitude and radius together", path: ["region_radius_m"] },
  );
export type CreateContributionRequest = z.infer<typeof CreateContributionRequestSchema>;

export const ReverseContributionRequestSchema = z.object({
  amount_cents: z.number().int().min(1).max(MAX_CONTRIBUTION_CENTS),
  note: z.string().trim().min(3).max(500),
});

export const ContributionSchema = z.object({
  id: Uuid,
  sponsor_id: Uuid,
  sponsor_name: z.string(),
  kind: z.string(),
  amount_cents: Cents,
  reverses_id: Uuid.nullable(),
  /** Human-readable earmark ("General pool", "Protocol street-flood-depth · 5 km around 33.78, -84.40"). */
  earmark: z.string(),
  protocol_slug: z.string().nullable(),
  bounty_id: Uuid.nullable(),
  note: z.string().nullable(),
  created_at: IsoDate,
});
export type Contribution = z.infer<typeof ContributionSchema>;

// ---------- pool (admin) ----------

export const PoolTotalsSchema = z.object({
  contributed_cents: Cents,
  allocated_cents: Cents,
  paid_cents: Cents,
  available_cents: Cents,
});
export type PoolTotals = z.infer<typeof PoolTotalsSchema>;

export const PoolBucketSchema = PoolTotalsSchema.extend({
  /** null = the general pool. */
  contribution_id: Uuid.nullable(),
  sponsor_name: z.string().nullable(),
  earmark: z.string(),
});
export type PoolBucket = z.infer<typeof PoolBucketSchema>;

export const FundingRequestSchema = z.object({
  id: Uuid,
  title: z.string(),
  status: z.string(),
  protocol_slug: z.string(),
  protocol_name: z.string(),
  requested_by: z.string().nullable(),
  created_at: IsoDate,
  starts_at: IsoDate,
  ends_at: IsoDate,
  cells_total: z.number().int(),
  target_per_cell: z.number().int(),
  justification: z.string().nullable(),
  funding_reason: z.string().nullable(),
  allocation_cents: Cents,
  spent_cents: Cents,
  estimated_need_cents: Cents,
  min_viable_cents: Cents,
});
export type FundingRequest = z.infer<typeof FundingRequestSchema>;

export const FundingOverviewSchema = z.object({
  totals: PoolTotalsSchema,
  buckets: z.array(PoolBucketSchema),
  sponsors: z.array(SponsorSchema),
  pending: z.array(FundingRequestSchema),
  funded: z.array(FundingRequestSchema),
  contributions: z.array(ContributionSchema),
});
export type FundingOverview = z.infer<typeof FundingOverviewSchema>;

// POST /api/admin/bounties/:id/allocation — approve (pending → active) or adjust to a new total.
export const SetAllocationRequestSchema = z.object({
  allocation_cents: z.number().int().min(0).max(MAX_CONTRIBUTION_CENTS),
  reason: z.string().trim().min(3).max(500),
});
export type SetAllocationRequest = z.infer<typeof SetAllocationRequestSchema>;

export const AllocationResultSchema = z.object({
  bounty_id: Uuid,
  status: z.string(),
  allocation_cents: Cents,
  funding_reason: z.string().nullable(),
});
export type AllocationResult = z.infer<typeof AllocationResultSchema>;

export const RunAllocationResponseSchema = z.object({
  funded: z.number().int(),
  still_pending: z.number().int(),
  released_cents: Cents,
});

// ---------- public transparency (no login, no per-user data) ----------

export const PublicFundingResponseSchema = z.object({
  sponsors: z.array(z.object({ name: z.string(), url: z.string().nullable(), logo_url: z.string().nullable(), contributed_cents: Cents })),
  totals: PoolTotalsSchema,
  requests: z.object({ active: z.number().int(), pending: z.number().int() }),
  updated_at: IsoDate,
});
export type PublicFundingResponse = z.infer<typeof PublicFundingResponseSchema>;

// ---------- pricing preview (researcher) ----------

// POST /api/pricing/preview — what the platform would pay per cell for a draft request right now.
export const PricingPreviewRequestSchema = z.object({
  protocol_id: Uuid,
  center_lat: Lat,
  center_lng: Lng,
  radius_m: z.number().min(50).max(20_000),
  area: PolygonSchema.optional(),
  target_per_cell: z.number().int().min(1).max(100),
  starts_at: IsoDate,
  ends_at: IsoDate,
  event_started_at: IsoDate.nullable().default(null),
});
export type PricingPreviewRequest = z.infer<typeof PricingPreviewRequestSchema>;

export const PricingPreviewResponseSchema = z.object({
  cells: z.array(CellPriceSchema),
  cells_total: z.number().int(),
  base_cents: Cents,
  ceiling_cents: Cents,
  /** Median cell price now. */
  price_cents: Cents,
  min_price_cents: Cents,
  max_price_cents: Cents,
  surge: z.number(),
  max_surge: z.number(),
  price_reasons: z.array(z.string()),
  estimated_need_cents: Cents,
  min_viable_cents: Cents,
  funding: z.object({
    /** Whether the engine would fund it right now if submitted. */
    would_fund: z.boolean(),
    allocation_cents: Cents,
    reason: z.string().nullable(),
  }),
});
export type PricingPreviewResponse = z.infer<typeof PricingPreviewResponseSchema>;
