/**
 * Read endpoints the PRD implies but does not list (dashboard lists, polling fallback for
 * realtime, local dev auth). Shared so web, dashboard, and mobile agree on shapes.
 */
import { z } from "zod";
import { VerifierSchema } from "../provenance";
import { ProtocolSchema } from "../protocols/protocol";
import { BountyStatusSchema, IsoDate, RoleSchema, SubmissionStatusSchema, Uuid } from "./common";
import { SubmissionRowSchema } from "./submissions";

// GET /api/submissions/:id  (owner or bounty owner) — polling fallback when realtime is unavailable
export const SubmissionWithMediaSchema = SubmissionRowSchema.extend({
  /** Short-lived signed URLs for `media`, same order. Empty for contributors' realtime payloads. */
  media_urls: z.array(z.string()),
  retryable: z.boolean(),
  bounty_title: z.string().nullable(),
  /** Who decided (model | mock | human | none). Optional: older servers omit it. */
  verifier: VerifierSchema.optional(),
});
export type SubmissionWithMedia = z.infer<typeof SubmissionWithMediaSchema>;

// GET /api/submissions?bounty_id&status&limit  (researcher)
export const SubmissionListQuerySchema = z.object({
  bounty_id: Uuid.optional(),
  status: SubmissionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const SubmissionListResponseSchema = z.object({ submissions: z.array(SubmissionWithMediaSchema) });

// GET /api/bounties  (researcher: own bounties; admin: all)
export const BountyListItemSchema = z.object({
  id: Uuid,
  title: z.string(),
  status: BountyStatusSchema,
  protocol_slug: z.string(),
  protocol_name: z.string(),
  center_lat: z.number(),
  center_lng: z.number(),
  cells_total: z.number().int(),
  accepted: z.number().int(),
  pending_review: z.number().int(),
  budget_cents: z.number().int(),
  spent_cents: z.number().int(),
  ends_at: IsoDate,
  created_at: IsoDate,
});
export const BountyListResponseSchema = z.object({ bounties: z.array(BountyListItemSchema) });
export type BountyListItem = z.infer<typeof BountyListItemSchema>;

// GET /api/protocols  (published + own drafts)
export const ProtocolListItemSchema = z.object({
  id: Uuid,
  slug: z.string(),
  version: z.number().int(),
  name: z.string(),
  status: z.enum(["draft", "published"]),
  example_image_url: z.string().nullable(),
  definition: ProtocolSchema,
});
export const ProtocolListResponseSchema = z.object({ protocols: z.array(ProtocolListItemSchema) });

// GET /api/redteam/runs?bounty_id
export const RedteamRunRowSchema = z.object({
  id: Uuid,
  bounty_id: Uuid,
  attack_type: z.enum(["ai_generated", "recycled", "wrong_place_time"]),
  caught: z.boolean(),
  status: z.string(),
  reason_codes: z.array(z.string()),
  checks: z.array(z.unknown()),
  image_url: z.string().nullable(),
  created_at: IsoDate,
});
export const RedteamRunListResponseSchema = z.object({ runs: z.array(RedteamRunRowSchema) });

// POST /api/dev/session — LOCAL_BACKEND=1 only. Issues a dev bearer token without Supabase Auth.
export const DEV_TOKEN_PREFIX = "dev.";
export const DevSessionRequestSchema = z.object({
  role: RoleSchema.default("contributor"),
  /** Reuse an existing dev user id (e.g. persisted on the phone). */
  user_id: Uuid.optional(),
});
export const DevSessionResponseSchema = z.object({
  user_id: Uuid,
  access_token: z.string(),
  role: RoleSchema,
});
export type DevSessionResponse = z.infer<typeof DevSessionResponseSchema>;

// GET /api/health — lets clients discover backend mode.
export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  backend: z.enum(["supabase", "local"]),
  mock_grok: z.boolean(),
  demo_mode: z.boolean(),
  realtime: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
