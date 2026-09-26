import { z } from "zod";
import { ProtocolSchema } from "../protocols/protocol";
import { IsoDate, Lat, Lng, Uuid } from "./common";
import { RadarFundingSchema } from "./grokbot";

// POST /api/voice/token
export const VoiceTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: IsoDate,
  model: z.string(),
  url: z.string(),
});
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponseSchema>;

// GET /api/me/wallet
export const LedgerEntrySchema = z.object({
  id: Uuid,
  submission_id: Uuid.nullable(),
  amount_cents: z.number().int(),
  kind: z.enum(["payout", "bonus", "adjustment", "reversal"]),
  created_at: IsoDate,
  bounty_title: z.string().nullable(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const WalletResponseSchema = z.object({
  balance_cents: z.number().int(),
  trust_score: z.number(),
  entries: z.array(LedgerEntrySchema),
});
export type WalletResponse = z.infer<typeof WalletResponseSchema>;

// POST /api/profile
export const NotificationPrefsSchema = z.object({
  max_per_day: z.number().int().min(0).max(3).default(3),
  quiet_hours: z
    .tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)])
    .nullable()
    .default(null),
  min_reward_cents: z.number().int().min(0).default(0),
});

export const ProfileRequestSchema = z.object({
  display_name: z.string().max(80).optional(),
  occupation: z.string().max(120).optional(),
  skills: z.array(z.string().max(60)).max(30).optional(),
  interests: z.array(z.string().max(60)).max(30).optional(),
  languages: z.array(z.string().max(40)).max(10).optional(),
  regular_areas: z
    .array(z.object({ label: z.string(), description: z.string() }))
    .max(10)
    .optional(),
  notification_prefs: NotificationPrefsSchema.optional(),
  is_adult: z.boolean().optional(),
  consent_license: z.boolean().optional(),
});
export type ProfileRequest = z.infer<typeof ProfileRequestSchema>;
export const ProfileResponseSchema = z.object({
  id: Uuid,
  role: z.string(),
  trust_score: z.number(),
});

// POST /api/protocols/:id/example-image
export const ExampleImageResponseSchema = z.object({ path: z.string(), url: z.string() });

// POST /api/protocols/draft (P1)
export const DraftProtocolRequestSchema = z.object({ need: z.string().min(10).max(2000) });
export const DraftProtocolResponseSchema = z.object({
  protocol_id: Uuid,
  protocol: ProtocolSchema,
});
// POST /api/protocols/:id/publish (P1)
export const PublishProtocolRequestSchema = z.object({ definition: ProtocolSchema.optional() });

// POST /api/radar/scan (P1)
export const RadarScanRequestSchema = z.object({
  lat: Lat,
  lng: Lng,
  radius_km: z.number().positive().max(300).default(50),
});
export const DraftBountySchema = z.object({
  title: z.string(),
  summary: z.string(),
  protocol_slug: z.string(),
  center_lat: z.number(),
  center_lng: z.number(),
  radius_m: z.number(),
  rationale: z.string(),
  sources: z.array(z.string()),
  alert_event: z.string().nullable(),
  /**
   * Grokbot (additive): what the allocation engine would grant this draft right now, computed
   * server-side after the model drafts it (never model output).
   */
  funding: RadarFundingSchema.optional(),
});
export type DraftBounty = z.infer<typeof DraftBountySchema>;
export const RadarScanResponseSchema = z.object({
  drafts: z.array(DraftBountySchema),
  alerts_considered: z.number().int(),
});

// POST /api/redteam/run
export const AttackTypeSchema = z.enum(["ai_generated", "recycled", "wrong_place_time"]);
export type AttackType = z.infer<typeof AttackTypeSchema>;
export const RedteamRunRequestSchema = z.object({
  bounty_id: Uuid,
  attack_type: AttackTypeSchema,
});
export const RedteamRunResponseSchema = z.object({
  run_id: Uuid,
  attack_type: AttackTypeSchema,
  caught: z.boolean(),
  status: z.string(),
  reason_codes: z.array(z.string()),
  image_url: z.string().nullable(),
});
export type RedteamRunResponse = z.infer<typeof RedteamRunResponseSchema>;

// POST /api/demo/spawn-event
export const SpawnEventRequestSchema = z.object({
  lat: Lat,
  lng: Lng,
  radius_m: z.number().min(100).max(5000).default(800),
});
export const SpawnEventResponseSchema = z.object({
  bounty_id: Uuid,
  seeded_observations: z.number().int(),
});
