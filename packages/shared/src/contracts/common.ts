import { z } from "zod";

export const Uuid = z.string().uuid();
export const IsoDate = z.string().datetime({ offset: true });
export const Lat = z.number().min(-90).max(90);
export const Lng = z.number().min(-180).max(180);

export const RoleSchema = z.enum(["contributor", "researcher", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

export const BountyStatusSchema = z.enum(["draft", "active", "paused", "closed"]);
export type BountyStatus = z.infer<typeof BountyStatusSchema>;

export const BountySourceSchema = z.enum(["manual", "nws", "radar", "demo"]);

export const SubmissionStatusSchema = z.enum([
  "pending",
  "verifying",
  "accepted",
  "rejected",
  "needs_review",
]);

export const SessionStatusSchema = z.enum(["open", "submitted", "expired", "abandoned"]);

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Test-only header: selects a mock fixture variant when MOCK_GROK=1 (e.g. "screen_recapture"). */
export const MOCK_VARIANT_HEADER = "x-mock-variant";
export const MockVariantSchema = z.enum(["default", "screen_recapture", "missing_element", "ai_generated", "error", "slow"]);
export type MockVariant = z.infer<typeof MockVariantSchema>;
