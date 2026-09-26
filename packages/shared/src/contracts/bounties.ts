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
});
export type BountySummary = z.infer<typeof BountySummarySchema>;

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
});
export type BountyDetail = z.infer<typeof BountyDetailSchema>;

// POST /api/bounties
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
    base_price_cents: z.number().int().min(1),
    max_price_cents: z.number().int().min(1),
    target_per_cell: z.number().int().min(1).max(100),
    priority: z.number().min(0.1).max(5).default(1),
    budget_cents: z.number().int().min(0),
    sponsor_name: z.string().max(120).nullable().default(null),
    sponsor_url: z.string().url().max(300).nullable().default(null),
    status: BountyStatusSchema.default("active"),
    source: BountySourceSchema.default("manual"),
  })
  .refine((b) => b.max_price_cents >= b.base_price_cents, { message: "max_price_cents < base" })
  .refine((b) => new Date(b.ends_at) > new Date(b.starts_at), { message: "ends_at <= starts_at" });
export type CreateBountyRequest = z.infer<typeof CreateBountyRequestSchema>;

export const CreateBountyResponseSchema = z.object({ id: Uuid, cells: z.array(z.string()) });

// PATCH /api/bounties/:id
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
