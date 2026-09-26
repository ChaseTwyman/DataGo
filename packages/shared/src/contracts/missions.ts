/**
 * Revisit missions, recession series and impact cards (migration 000010).
 *
 * A mission is time-windowed demand on one H3 cell of one request: "measure this spot again at
 * +30 min". It is priced by the platform engine (a "Revisit due here" reason) and paid from the same
 * request allocation; the capture flow (server gate included) is unchanged.
 */
import { z } from "zod";
import { IsoDate, Lat, Lng, Uuid } from "./common";

export const MissionStatusSchema = z.enum(["open", "filled", "expired", "cancelled"]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

/** One mission as a contributor sees it (never another contributor's id). */
export const MissionSummarySchema = z.object({
  id: Uuid,
  bounty_id: Uuid,
  bounty_title: z.string(),
  protocol_name: z.string(),
  cell: z.string(),
  /** Cell centre (the reading's own point is never exposed). */
  lat: Lat,
  lng: Lng,
  sequence: z.number().int().min(1),
  interval_min: z.number().int().positive(),
  due_at: IsoDate,
  opens_at: IsoDate,
  closes_at: IsoDate,
  /** Until then only the original contributor may fill it. */
  dibs_until: IsoDate,
  status: MissionStatusSchema,
  /** The caller took the original reading (has first dibs). */
  yours: z.boolean(),
  /** Reserved for the original contributor right now (the caller can't fill it yet). */
  reserved: z.boolean(),
  /** Live cell price for the caller, when the request is priced (null: not available). */
  price_cents: z.number().int().nonnegative().nullable(),
  price_reasons: z.array(z.string()),
  distance_m: z.number().nonnegative().nullable(),
});
export type MissionSummary = z.infer<typeof MissionSummarySchema>;

export const NearbyMissionsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().positive().max(200).default(25),
});
export const NearbyMissionsResponseSchema = z.object({ missions: z.array(MissionSummarySchema) });
export type NearbyMissionsResponse = z.infer<typeof NearbyMissionsResponseSchema>;

/** Lenient read side for installed phone builds (unknown statuses/fields must not break parsing). */
export const LenientMissionSummarySchema = MissionSummarySchema.extend({
  status: z.string(),
  price_reasons: z.array(z.string()).catch([]),
  price_cents: z.number().nullable().catch(null),
  distance_m: z.number().nullable().catch(null),
}).loose();
export const LenientNearbyMissionsResponseSchema = z.object({
  missions: z.array(z.unknown()).transform((xs) =>
    xs.flatMap((x) => {
      const p = LenientMissionSummarySchema.safeParse(x);
      return p.success ? [p.data] : [];
    }),
  ),
});
export type LenientMissionSummary = z.infer<typeof LenientMissionSummarySchema>;

/** Researcher view of one request's missions. */
export const BountyMissionSchema = z.object({
  id: Uuid,
  cell: z.string(),
  sequence: z.number().int().min(1),
  interval_min: z.number().int().positive(),
  due_at: IsoDate,
  opens_at: IsoDate,
  closes_at: IsoDate,
  dibs_until: IsoDate,
  status: MissionStatusSchema,
  source_submission_id: Uuid,
  filled_submission_id: Uuid.nullable(),
  filled_at: IsoDate.nullable(),
});
export type BountyMission = z.infer<typeof BountyMissionSchema>;

/** One reading on a recession curve: minutes after the first reading at the cell. */
export const RecessionPointSchema = z.object({
  submission_id: Uuid,
  captured_at: IsoDate,
  minutes: z.number().nonnegative(),
  value: z.number().nullable(),
});
export const RecessionSeriesSchema = z.object({
  root_submission_id: Uuid,
  cell: z.string(),
  /** Extraction field plotted (flood: depth_cm), from the protocol's corroboration_field. */
  field: z.string().nullable(),
  points: z.array(RecessionPointSchema),
});
export type RecessionSeries = z.infer<typeof RecessionSeriesSchema>;

export const BountyMissionsResponseSchema = z.object({
  missions: z.array(BountyMissionSchema),
  recession: z.array(RecessionSeriesSchema),
});
export type BountyMissionsResponse = z.infer<typeof BountyMissionsResponseSchema>;

export const ImpactCardRequestSchema = z.object({
  /** Ask for a Grok Imagine abstract background (labelled AI-generated; cost-capped, may fall back). */
  ai_background: z.boolean().default(false),
});
export const ImpactCardResponseSchema = z.object({
  url: z.string().url(),
  ai_background: z.boolean(),
  cached: z.boolean(),
  /** Why an AI background was requested but not used (cap reached, generation failed). */
  note: z.string().nullable(),
});
export type ImpactCardResponse = z.infer<typeof ImpactCardResponseSchema>;
export const LenientImpactCardResponseSchema = ImpactCardResponseSchema.extend({
  ai_background: z.boolean().catch(false),
  cached: z.boolean().catch(false),
  note: z.string().nullable().catch(null),
}).loose();
