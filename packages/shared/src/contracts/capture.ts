import { z } from "zod";
import { ChallengeSchema, ProtocolSchema } from "../protocols/protocol";
import { FrameCheckResultSchema } from "../verificationSchema";
import { IsoDate, Lat, Lng, Uuid } from "./common";

// POST /api/capture/sessions
export const CreateSessionRequestSchema = z.object({
  bounty_id: Uuid,
  lat: Lat,
  lng: Lng,
  accuracy_m: z.number().min(0),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SignedUploadSchema = z.object({
  /** Storage path inside the `observations` bucket. */
  path: z.string(),
  signed_url: z.string(),
  token: z.string(),
});
export type SignedUpload = z.infer<typeof SignedUploadSchema>;

export const CreateSessionResponseSchema = z.object({
  session_id: Uuid,
  nonce: z.string(),
  challenge: ChallengeSchema,
  price_quote_cents: z.number().int(),
  quote_expires_at: IsoDate,
  expires_at: IsoDate,
  cell: z.string(),
  uploads: z.array(SignedUploadSchema),
  protocol: ProtocolSchema,
  frame_check_limit: z.number().int(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

// POST /api/capture/frame-check
export const FRAME_CHECK_LIMIT = 90;

export const FrameCheckRequestSchema = z.object({
  session_id: Uuid,
  /** base64 JPEG (no data: prefix), ~640 px long edge. */
  image_base64: z.string().min(100).max(2_000_000),
});
export type FrameCheckRequest = z.infer<typeof FrameCheckRequestSchema>;

export const FrameCheckResponseSchema = z.object({
  result: FrameCheckResultSchema,
  all_green: z.boolean(),
  checks_used: z.number().int(),
  checks_remaining: z.number().int(),
  ms: z.number().int(),
});
export type FrameCheckResponse = z.infer<typeof FrameCheckResponseSchema>;
