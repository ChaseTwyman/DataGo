import { z } from "zod";
import { ChecksSchema } from "../checks";
import { ReasonCodeSchema } from "../reasonCodes";
import { IsoDate, Lat, Lng, SubmissionStatusSchema, Uuid } from "./common";

export const MediaItemSchema = z.object({
  path: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  captured_at: IsoDate,
  exif: z.record(z.string(), z.unknown()).optional(),
});
export type MediaItem = z.infer<typeof MediaItemSchema>;

export const DeviceInfoSchema = z.object({
  model: z.string().nullable(),
  os: z.string(),
  os_version: z.string().nullable(),
  app_version: z.string().nullable(),
});
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

export const SensorSnapshotSchema = z.object({
  tilt_deg: z.number().nullable(),
  rotation_rate: z.number().nullable(),
  heading_deg: z.number().nullable().optional(),
  steady: z.boolean().nullable(),
});
export type SensorSnapshot = z.infer<typeof SensorSnapshotSchema>;

export const GateInfoSchema = z.object({
  degraded: z.boolean(),
  frame_checks: z.number().int().min(0),
  consecutive_green: z.number().int().min(0),
  last_hint: z.string().nullable(),
});
export type GateInfo = z.infer<typeof GateInfoSchema>;

export const FieldNotesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type FieldNotes = z.infer<typeof FieldNotesSchema>;

// POST /api/submissions
export const CreateSubmissionRequestSchema = z.object({
  session_id: Uuid,
  nonce: z.string().min(8),
  media: z.array(MediaItemSchema).min(1).max(6),
  lat: Lat,
  lng: Lng,
  accuracy_m: z.number().min(0),
  captured_at: IsoDate,
  device: DeviceInfoSchema,
  sensors: SensorSnapshotSchema,
  field_notes: FieldNotesSchema.default({}),
  gate: GateInfoSchema,
});
export type CreateSubmissionRequest = z.infer<typeof CreateSubmissionRequestSchema>;

export const CreateSubmissionResponseSchema = z.object({
  submission_id: Uuid,
  status: SubmissionStatusSchema,
});
export type CreateSubmissionResponse = z.infer<typeof CreateSubmissionResponseSchema>;

/** Row shape of `submissions` as read by clients (realtime payloads use this too). */
export const SubmissionRowSchema = z.object({
  id: Uuid,
  session_id: Uuid.nullable(),
  bounty_id: Uuid,
  user_id: Uuid,
  media: z.array(MediaItemSchema),
  lat: z.number(),
  lng: z.number(),
  accuracy_m: z.number().nullable(),
  h3_cell: z.string(),
  captured_at: IsoDate,
  received_at: IsoDate,
  status: SubmissionStatusSchema,
  checks: ChecksSchema,
  reason_codes: z.array(ReasonCodeSchema),
  confidence: z.number().nullable(),
  protocol_score: z.number().nullable(),
  authenticity_score: z.number().nullable(),
  extracted: z.record(z.string(), z.unknown()).nullable(),
  field_notes: FieldNotesSchema.nullable(),
  payout_cents: z.number().int().nullable(),
});
export type SubmissionRow = z.infer<typeof SubmissionRowSchema>;

// POST /api/submissions/:id/review
export const ReviewRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  integrity: z.boolean().default(false),
  note: z.string().max(500).optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const ReviewResponseSchema = z.object({
  submission_id: Uuid,
  status: SubmissionStatusSchema,
  payout_cents: z.number().int(),
});
