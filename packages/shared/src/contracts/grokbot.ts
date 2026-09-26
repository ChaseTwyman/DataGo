/**
 * Grokbot: one continuous, role-scoped operator across the GroundTruth loop.
 *
 * Laws (enforced server-side, never by the agent): pricing, the capture gate, "never auto-accept",
 * RLS/role permissions. The agent only reads a role-scoped CASE FILE and explains, drafts, and
 * suggests; anything that changes state needs a human click on an existing endpoint.
 *
 * Guardrails baked into these shapes:
 * - Grounded: every explanation carries citations to stored facts (stage/code/field/price reason).
 * - Role-scoped: contributors never see which integrity check fired; sponsors never see individuals.
 * - Reviewer briefs carry evidence + uncertainty and deliberately NO verdict field.
 * - Contributor-supplied text (field notes, OCR'd image text) is untrusted data; suspected prompt
 *   injection is surfaced, not obeyed.
 */
import { z } from "zod";
import { IsoDate, Uuid } from "./common";

/** A pointer to the stored fact a sentence is based on. */
export const CitationSchema = z.object({
  kind: z.enum(["stage", "reason_code", "extracted_field", "price_reason", "pool", "protocol", "profile", "alert", "observation"]),
  ref: z.string().max(120), // e.g. "relevance", "OFF_TOPIC", "depth_cm", "Few readings here"
  detail: z.string().max(300).nullable(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const GrokbotMessageSchema = z.object({
  headline: z.string().max(160),
  paragraphs: z.array(z.string().max(600)).max(6),
  next_steps: z.array(z.string().max(200)).max(5),
  citations: z.array(CitationSchema).max(20),
  /** "grok" when a model wrote it; "template" when the deterministic fallback did (Grok down/mock). */
  source: z.enum(["grok", "template"]),
  generated_at: IsoDate,
});
export type GrokbotMessage = z.infer<typeof GrokbotMessageSchema>;

// ---- Phase 1: verification companion ------------------------------------------------------
// GET /api/grokbot/submissions/:id/narration?after=<n>  (submission owner or bounty owner)
// Short lines as stages complete, for the phone to show/speak during the ~40 s verify, then the
// final explanation once terminal. Integrity rejects narrate neutrally for contributors.
export const NarrationLineSchema = z.object({
  seq: z.number().int().min(0),
  stage: z.string(),
  text: z.string().max(200), // speakable, < ~15 words
  at: IsoDate,
});
export const NarrationResponseSchema = z.object({
  lines: z.array(NarrationLineSchema),
  done: z.boolean(),
  final: GrokbotMessageSchema.nullable(),
});
export type NarrationResponse = z.infer<typeof NarrationResponseSchema>;

// GET /api/grokbot/submissions/:id/explain → GrokbotMessage (role-scoped; cached per status)

// ---- Phase 2: Studio self-check -------------------------------------------------------------
// POST /api/grokbot/protocols/:id/self-check (researcher owner) → runs the protocol's example image
// (generated if missing) through the live frame-check and relevance models before publishing.
export const ElementCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  verdict: z.enum(["ok", "weak", "undetectable"]),
  confidence: z.number().min(0).max(1).nullable(),
  suggestion: z.string().max(240).nullable(),
});
export const StudioSelfCheckSchema = z.object({
  protocol_id: Uuid,
  overall: z.enum(["ready", "revise"]),
  elements: z.array(ElementCheckSchema),
  relevance_ok: z.boolean(),
  example_image_url: z.string().nullable(),
  suggestions: z.array(z.string().max(240)).max(8),
  checked_at: IsoDate,
});
export type StudioSelfCheck = z.infer<typeof StudioSelfCheckSchema>;

// ---- Phase 3: For-you personalization -----------------------------------------------------
// Server fills match_cache (skill_fit 0..1 + one-sentence reason) from the contributor profile
// (occupation, skills, interests, regular areas) × bounty/protocol, via the fast model, cached.
// Existing BountySummary.match_score / match_reason carry it; nothing new on the wire except:
// POST /api/grokbot/match/refresh (self) → { refreshed: number }
export const MatchRefreshResponseSchema = z.object({ refreshed: z.number().int().min(0) });

// Contributor "why this price?": GET /api/grokbot/bounties/:id/price-why?lat&lng → GrokbotMessage
// (grounded only in price_reasons + public factors; never exposes engine weights).

// ---- Phase 4: pool-aware Radar + request status -------------------------------------------
export const RadarFundingSchema = z.object({
  fundable: z.boolean(),
  estimated_allocation_cents: z.number().int().min(0),
  reason: z.string().max(240),
});
export type RadarFunding = z.infer<typeof RadarFundingSchema>;
// RadarScanResponse drafts gain optional `funding: RadarFunding` (additive, in misc.ts).

// GET /api/grokbot/bounties/:id/status (bounty owner or admin) → GrokbotMessage explaining
// funded / pending_funding / paused / budget pacing, with "what would help" next steps.

// ---- Phase 5: reviewer brief + sponsor impact report -------------------------------------
// GET /api/grokbot/submissions/:id/review-brief (researcher owner or admin). NO verdict field.
export const EvidenceItemSchema = z.object({
  claim: z.string().max(300),
  supports: z.enum(["authentic", "inauthentic", "protocol_ok", "protocol_issue", "context", "neutral"]),
  strength: z.enum(["strong", "moderate", "weak"]),
  citation: CitationSchema,
});
export const ReviewBriefSchema = z.object({
  submission_id: Uuid,
  summary: z.string().max(600),
  evidence: z.array(EvidenceItemSchema).max(20),
  uncertainties: z.array(z.string().max(240)).max(8),
  suggested_checks: z.array(z.string().max(240)).max(6),
  /** Contributor-supplied text that looked like instructions to an AI (ignored, surfaced). */
  injection_flags: z.array(z.string().max(240)).max(5),
  source: z.enum(["grok", "template"]),
  generated_at: IsoDate,
});
export type ReviewBrief = z.infer<typeof ReviewBriefSchema>;

// GET /api/grokbot/sponsors/:id/impact?from&to (admin) and GET /api/public/sponsors/:id/impact
// (public, aggregate only). Never names or locates individual contributors.
export const SponsorImpactSchema = z.object({
  sponsor_id: Uuid,
  sponsor_name: z.string(),
  period_from: IsoDate,
  period_to: IsoDate,
  contributed_cents: z.number().int(),
  spent_cents: z.number().int(),
  observations_accepted: z.number().int(),
  cells_covered: z.number().int(),
  requests_funded: z.number().int(),
  highlights: z.array(z.string().max(240)).max(6),
  narrative: GrokbotMessageSchema,
});
export type SponsorImpact = z.infer<typeof SponsorImpactSchema>;
