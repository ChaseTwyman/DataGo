/**
 * Forward-compatible READ-SIDE schemas for clients (phone, dashboard).
 *
 * Why: installed phone builds can't be updated with the server. When the server added the
 * `relevance` stage and new reason codes (OFF_TOPIC, GATE_NOT_PASSED, EXTRACTION_*), old builds
 * parsed responses with closed `z.enum`s and failed with "contract mismatch" on every result screen.
 *
 * Rules here:
 *  - closed enums the UI only *displays* (stage ids, reason codes, statuses, kinds) become open
 *    strings typed `Known | (string & {})`, so renderers keep the value and fall back to a neutral
 *    label for ones they don't know;
 *  - enums inside a Protocol, which drives capture logic typed as `Protocol`, fall back to a safe
 *    known value with `.catch()` (unknown field-question type → free text, unknown extraction rule
 *    → dropped), so the output is still a valid `Protocol`;
 *  - lists drop individual items that don't parse instead of failing the whole payload;
 *  - unknown extra fields are ignored (zod objects strip them).
 *
 * The strict schemas elsewhere in `contracts/` stay the source of truth for what the SERVER accepts
 * and writes. Never use these to validate input.
 */
import { z } from "zod";
import { StageResultSchema, SubcheckSchema, type StageId, type StageStatus } from "../checks";
import { ExtractionRuleSchema, FieldQuestionSchema, ProtocolSchema, type FieldQuestion, type Protocol } from "../protocols/protocol";
import type { Verifier } from "../provenance";
import type { ReasonCode } from "../reasonCodes";
import { BountyDetailSchema, BountySummarySchema, NearbyResponseSchema } from "./bounties";
import type { BountyStatus, Role } from "./common";
import { CreateSessionResponseSchema } from "./capture";
import { BountyListItemSchema, DevSessionResponseSchema, HealthResponseSchema, ProtocolListItemSchema, RedteamRunRowSchema, SubmissionWithMediaSchema } from "./lists";
import { LedgerEntrySchema, RedteamRunResponseSchema, WalletResponseSchema, type AttackType } from "./misc";
import { CreateSubmissionResponseSchema, ReviewResponseSchema, SubmissionRowSchema } from "./submissions";

/** A value from a known set, or any other string a newer server may send. */
export type Open<T extends string> = T | (string & {});

type SubmissionStatus = "pending" | "verifying" | "accepted" | "rejected" | "needs_review";

/** Any string, typed as "one of the known values or something newer". Non-strings still fail. */
export function openString<T extends string>() {
  return z.string().transform((s): Open<T> => s);
}

/** Array that keeps the items that parse and silently drops the rest (a missing array → []). */
export function lenientArray<S extends z.ZodType>(item: S) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((xs) =>
      xs.flatMap((x) => {
        const p = item.safeParse(x);
        return p.success ? [p.data as z.output<S>] : [];
      }),
    );
}

// ---------- verification checks ----------

export const LenientSubcheckSchema = SubcheckSchema.extend({ status: openString<StageStatus>() });

/** One pipeline stage. Unknown stage ids keep the payload's own `label` for display. */
export const LenientStageResultSchema = StageResultSchema.extend({
  stage: openString<StageId>(),
  status: openString<StageStatus>(),
  score: z.number().nullable().catch(null),
  reasonCodes: lenientArray(openString<ReasonCode>()),
  evidence: lenientArray(z.string()),
  subchecks: lenientArray(LenientSubcheckSchema).optional(),
  ms: z.number().catch(0),
});
export type LenientStageResult = z.infer<typeof LenientStageResultSchema>;

export const LenientChecksSchema = lenientArray(LenientStageResultSchema);

// ---------- protocol (output stays a valid Protocol) ----------

/** Unknown question type (a newer server) → ask it as free text rather than failing the briefing. */
export const LenientFieldQuestionSchema: z.ZodType<FieldQuestion> = z.union([
  FieldQuestionSchema,
  z.object({ id: z.string().min(1), question: z.string().min(1) }).transform((q): FieldQuestion => ({ id: q.id, question: q.question, type: "text" })),
]);

const P = ProtocolSchema.shape;

export const LenientProtocolSchema = ProtocolSchema.extend({
  safety: P.safety.extend({ level: P.safety.shape.level.catch("elevated") }),
  capture: P.capture.extend({
    mode: P.capture.shape.mode.catch("burst"),
    orientation: P.capture.shape.orientation.catch("any"),
    field_questions: lenientArray(LenientFieldQuestionSchema),
  }),
  // Clients never evaluate extraction rules (the server does); unknown rule kinds are dropped.
  acceptance: P.acceptance.extend({ extraction_rules: lenientArray(ExtractionRuleSchema).optional() }),
});
// Compile-time guarantee that the lenient protocol can be used anywhere a Protocol is expected.
const _protocolCompat: (p: z.infer<typeof LenientProtocolSchema>) => Protocol = (p) => p;
void _protocolCompat;

// ---------- submissions ----------

export const LenientSubmissionRowSchema = SubmissionRowSchema.extend({
  status: openString<SubmissionStatus>(),
  checks: LenientChecksSchema,
  reason_codes: lenientArray(openString<ReasonCode>()),
  media: lenientArray(SubmissionRowSchema.shape.media.element),
  confidence: z.number().nullable().catch(null),
  protocol_score: z.number().nullable().catch(null),
  authenticity_score: z.number().nullable().catch(null),
  extracted: z.record(z.string(), z.unknown()).nullable().catch(null),
  field_notes: z.record(z.string(), z.unknown()).nullable().catch(null),
  payout_cents: z.number().int().nullable().catch(null),
});
export type LenientSubmissionRow = z.infer<typeof LenientSubmissionRowSchema>;

export const LenientSubmissionWithMediaSchema = LenientSubmissionRowSchema.extend({
  media_urls: lenientArray(z.string()),
  retryable: z.boolean().catch(false),
  bounty_title: z.string().nullable().catch(null),
  verifier: openString<Verifier>().optional().catch(undefined),
});
export type LenientSubmissionWithMedia = z.infer<typeof LenientSubmissionWithMediaSchema>;
// Compile-time: a strictly-parsed submission is always a valid lenient one (renderers accept both).
const _submissionCompat: (s: z.infer<typeof SubmissionWithMediaSchema>) => LenientSubmissionWithMedia = (s) => s;
void _submissionCompat;

export const LenientSubmissionListResponseSchema = z.object({ submissions: lenientArray(LenientSubmissionWithMediaSchema) });

export const LenientCreateSubmissionResponseSchema = CreateSubmissionResponseSchema.extend({ status: openString<SubmissionStatus>() });
export const LenientReviewResponseSchema = ReviewResponseSchema.extend({ status: openString<SubmissionStatus>() });

// ---------- bounties / capture ----------

export const LenientNearbyResponseSchema = NearbyResponseSchema.extend({ bounties: lenientArray(BountySummarySchema) });

export const LenientBountyDetailSchema = BountyDetailSchema.extend({
  status: openString<BountyStatus>(),
  source: openString<"manual" | "nws" | "radar" | "demo">(),
  protocol: LenientProtocolSchema,
  coverage: lenientArray(BountyDetailSchema.shape.coverage.element),
});
export type LenientBountyDetail = z.infer<typeof LenientBountyDetailSchema>;

export const LenientBountyListResponseSchema = z.object({
  bounties: lenientArray(BountyListItemSchema.extend({ status: openString<BountyStatus>() })),
});
export type LenientBountyListItem = z.infer<typeof LenientBountyListResponseSchema>["bounties"][number];

export const LenientCreateSessionResponseSchema = CreateSessionResponseSchema.extend({ protocol: LenientProtocolSchema });
export type LenientCreateSessionResponse = z.infer<typeof LenientCreateSessionResponseSchema>;

export const LenientProtocolListResponseSchema = z.object({
  protocols: lenientArray(ProtocolListItemSchema.extend({ status: openString<"draft" | "published">(), definition: LenientProtocolSchema })),
});
export type LenientProtocolListItem = z.infer<typeof LenientProtocolListResponseSchema>["protocols"][number];

// ---------- misc ----------

export const LenientWalletResponseSchema = WalletResponseSchema.extend({
  entries: lenientArray(LedgerEntrySchema.extend({ kind: openString<"payout" | "bonus" | "adjustment" | "reversal">() })),
});
export type LenientWalletResponse = z.infer<typeof LenientWalletResponseSchema>;

export const LenientHealthResponseSchema = HealthResponseSchema.extend({
  backend: openString<"supabase" | "local">(),
  mock_grok: z.boolean().catch(false),
  demo_mode: z.boolean().catch(false),
  realtime: z.boolean().catch(false),
});
export type LenientHealthResponse = z.infer<typeof LenientHealthResponseSchema>;

export const LenientDevSessionResponseSchema = DevSessionResponseSchema.extend({ role: openString<Role>() });

const LenientRedteamRunRowSchema = RedteamRunRowSchema.extend({ attack_type: openString<AttackType>() });
export const LenientRedteamRunListResponseSchema = z.object({ runs: lenientArray(LenientRedteamRunRowSchema) });
export const LenientRedteamRunResponseSchema = RedteamRunResponseSchema.extend({ attack_type: openString<AttackType>() });
