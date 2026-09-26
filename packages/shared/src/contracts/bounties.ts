import { z } from "zod";
import { ProtocolSchema } from "../protocols/protocol";
import { BountySourceSchema, BountyStatusSchema, IsoDate, Lat, Lng, Uuid } from "./common";

export const PolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
});

export const CellPriceSchema = z.object({
  cell: z.string(),
  accepted: z.number().int().min(0),
  target: z.number().int().min(1),
  price_cents: z.number().int().min(0),
  surge: z.number(),
  paused: z.boolean(),
  paused_reason: z.string().nullable(),
  /** Why the platform's pricing engine set this price, strongest first ("Few readings here", …). */
  price_reasons: z.array(z.string()).optional(),
});
export type CellPrice = z.infer<typeof CellPriceSchema>;

// GET /api/bounties/nearby?lat&lng&radius_km
export const NearbyQuerySchema = z.object({
  lat: z.coerce.number().pipe(Lat),
  lng: z.coerce.number().pipe(Lng),
  radius_km: z.coerce.number().positive().max(500).default(25),
});
export type NearbyQuery = z.infer<typeof NearbyQuerySchema>;

export const BountySummarySchema = z.object({
  id: Uuid,
  title: z.string(),
  summary: z.string(),
  protocol_slug: z.string(),
  protocol_name: z.string(),
  safety_level: z.string(),
  center_lat: z.number(),
  center_lng: z.number(),
  radius_m: z.number(),
  distance_m: z.number(),
  /** Price of the cell nearest the user (or the best open cell). */
  price_cents: z.number().int(),
  surge: z.number(),
  max_surge: z.number(),
  ends_at: IsoDate,
  cells_total: z.number().int(),
  cells_needed: z.number().int(),
  paused_cells: z.number().int(),
  match_score: z.number().min(0).max(1).nullable(),
  match_reason: z.string().nullable(),
  budget_remaining_cents: z.number().int(),
  example_image_url: z.string().nullable(),
  /** Who funds the bounty. Data is free for everyone; sponsors pay to direct collection. */
  sponsor_name: z.string().nullable().default(null),
  sponsor_url: z.string().nullable().default(null),
  /** Reasons behind `price_cents` (the picked cell's price), strongest first. */
  price_reasons: z.array(z.string()).optional(),
});
export type BountySummary = z.infer<typeof BountySummarySchema>;

/** Funding of a request (owner/admin view only; contributors get null). All money in cents. */
export const BountyFundingSchema = z.object({
  /** = budget_cents: the pool money set aside for this request. */
  allocation_cents: z.number().int(),
  spent_cents: z.number().int(),
  /** Worst-case value of locked quotes that may still be paid. */
  committed_cents: z.number().int(),
  remaining_cents: z.number().int(),
  funded_at: IsoDate.nullable(),
  /** Why the request is still pending_funding (or was paused by the engine). */
  funding_reason: z.string().nullable(),
  /** The engine's estimate of what filling every cell to target costs. */
  estimated_need_cents: z.number().int(),
  sources: z.array(z.object({ sponsor_name: z.string(), earmark: z.string(), amount_cents: z.number().int() })),
  /** "ahead" (spending faster than the clock), "on_track", "behind" (under-spending), "unfunded". */
  pace: z.string(),
  base_cents: z.number().int(),
  ceiling_cents: z.number().int(),
});
export type BountyFunding = z.infer<typeof BountyFundingSchema>;

export const NearbyResponseSchema = z.object({ bounties: z.array(BountySummarySchema) });
export type NearbyResponse = z.infer<typeof NearbyResponseSchema>;

// GET /api/bounties/:id
export const BountyDetailSchema = z.object({
  id: Uuid,
  title: z.string(),
  summary: z.string(),
  status: BountyStatusSchema,
  source: BountySourceSchema,
  protocol_id: Uuid,
  protocol: ProtocolSchema,
  area: PolygonSchema,
  center_lat: z.number(),
  center_lng: z.number(),
  radius_m: z.number(),
  cells: z.array(z.string()),
  starts_at: IsoDate,
  ends_at: IsoDate,
  event_started_at: IsoDate.nullable(),
  base_price_cents: z.number().int(),
  max_price_cents: z.number().int(),
  target_per_cell: z.number().int(),
  priority: z.number(),
  budget_cents: z.number().int(),
  spent_cents: z.number().int(),
  example_image_url: z.string().nullable(),
  briefing_video_url: z.string().nullable(),
  /** Who funds the bounty. Data is free for everyone; sponsors pay to direct collection. */
  sponsor_name: z.string().nullable().default(null),
  sponsor_url: z.string().nullable().default(null),
  coverage: z.array(CellPriceSchema),
  /** The researcher's reason for the request (sponsor-pool model). */
  justification: z.string().nullable().optional(),
  /** Owner/admin only; null for everyone else. */
  funding: BountyFundingSchema.nullable().optional(),
});
export type BountyDetail = z.infer<typeof BountyDetailSchema>;

// POST /api/bounties — a DATA REQUEST. Researchers no longer set prices, budgets, priority, status or
// sponsors: the platform funds requests from the sponsor pool and prices every cell. Old clients that
// still send those fields are accepted; the fields are ignored (zod strips unknown keys).
export const CreateBountyRequestSchema = z
  .object({
    protocol_id: Uuid,
    title: z.string().min(3).max(120),
    summary: z.string().max(500).default(""),
    center_lat: Lat,
    center_lng: Lng,
    radius_m: z.number().min(50).max(20_000),
    area: PolygonSchema.optional(),
    starts_at: IsoDate,
    ends_at: IsoDate,
    event_started_at: IsoDate.nullable().default(null),
    target_per_cell: z.number().int().min(1).max(100),
    /** Why this data is needed (shown to admins deciding on funding). */
    justification: z.string().trim().max(1000).default(""),
    source: BountySourceSchema.default("manual"),
  })
  .refine((b) => new Date(b.ends_at) > new Date(b.starts_at), { message: "ends_at <= starts_at", path: ["ends_at"] });
export type CreateBountyRequest = z.infer<typeof CreateBountyRequestSchema>;

export const CreateBountyResponseSchema = z.object({
  id: Uuid,
  cells: z.array(z.string()),
  /** "active" when the allocation engine funded it right away, else "pending_funding". */
  status: z.string().optional(),
  allocation_cents: z.number().int().optional(),
  funding_reason: z.string().nullable().optional(),
});

// PATCH /api/bounties/:id
// Researchers (owners): title, summary, ends_at, status (pause/resume/close; activating needs an
// allocation). Admins also: target_per_cell and sponsor display fields. Prices, priority and budget
// are platform-owned: sending them is refused (allocations change via /api/admin/bounties/:id/allocation).
export const PatchBountyRequestSchema = z.object({
  title: z.string().min(3).max(120).optional(),
  summary: z.string().max(500).optional(),
  status: BountyStatusSchema.optional(),
  ends_at: IsoDate.optional(),
  base_price_cents: z.number().int().min(1).optional(),
  max_price_cents: z.number().int().min(1).optional(),
  target_per_cell: z.number().int().min(1).optional(),
  priority: z.number().min(0.1).max(5).optional(),
  budget_cents: z.number().int().min(0).optional(),
  /** null clears the sponsor. */
  sponsor_name: z.string().max(120).nullable().optional(),
  sponsor_url: z.string().url().max(300).nullable().optional(),
});
export type PatchBountyRequest = z.infer<typeof PatchBountyRequestSchema>;

// GET /api/bounties/:id/coverage
export const CoverageResponseSchema = z.object({
  bounty_id: Uuid,
  cells: z.array(CellPriceSchema),
  computed_at: IsoDate,
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

// GET /api/bounties/:id/export?format=csv|geojson
export const ExportQuerySchema = z.object({ format: z.enum(["csv", "geojson", "dictionary"]).default("csv") });

// POST /api/bounties/:id/briefing-video (P1)
export const BriefingVideoResponseSchema = z.object({ request_id: z.string(), status: z.string() });

export const CreateBountyPreviewSchema = z.object({ lat: Lat, lng: Lng, radius_m: z.number() });
