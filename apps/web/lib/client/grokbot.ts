/**
 * Grokbot on the researcher dashboard: read-side schemas and presentation rules. Pure (no React,
 * no fetch) except the self-check job store, so everything here is unit-tested in grokbot.test.ts.
 *
 * Contract: packages/shared/src/contracts/grokbot.ts. The dashboard is built against it before
 * (and after) the server ships each endpoint, so parsing is lenient like contracts/lenient.ts:
 * open strings for displayed enums, lists that drop unreadable items, and unknown fields stripped.
 * Stripping matters for the reviewer brief: it has deliberately NO verdict, and if a server ever
 * sent one (`recommendation`, `verdict`, …) this parser drops it before any component sees it.
 */
import { z } from "zod";
import {
  DraftBountySchema,
  lenientArray,
  openString,
  PublicFundingResponseSchema,
  RadarScanResponseSchema,
  stageLabel,
} from "@groundtruth/shared";
import { ApiClientError, errorMessage } from "./errors";

// ---------------------------------------------------------------- lenient read-side schemas

type CitationKind = "stage" | "reason_code" | "extracted_field" | "price_reason" | "pool" | "protocol" | "profile" | "alert" | "observation";

export const LenientCitationSchema = z.object({
  kind: openString<CitationKind>(),
  ref: z.string(),
  detail: z.string().nullable().catch(null),
});
export type LenientCitation = z.infer<typeof LenientCitationSchema>;

export const LenientGrokbotMessageSchema = z.object({
  headline: z.string(),
  paragraphs: lenientArray(z.string()),
  next_steps: lenientArray(z.string()),
  citations: lenientArray(LenientCitationSchema),
  source: openString<"grok" | "template">().catch("grok"),
  generated_at: z.string().nullable().catch(null),
});
export type LenientGrokbotMessage = z.infer<typeof LenientGrokbotMessageSchema>;

type Verdict = "ok" | "weak" | "undetectable";

export const LenientElementCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  verdict: openString<Verdict>(),
  confidence: z.number().nullable().catch(null),
  suggestion: z.string().nullable().catch(null),
});
export type LenientElementCheck = z.infer<typeof LenientElementCheckSchema>;

export const LenientSelfCheckSchema = z.object({
  protocol_id: z.string(),
  overall: openString<"ready" | "revise">(),
  elements: lenientArray(LenientElementCheckSchema),
  /** null when the server didn't say (never assume it passed or failed). */
  relevance_ok: z.boolean().nullable().catch(null),
  example_image_url: z.string().nullable().catch(null),
  suggestions: lenientArray(z.string()),
  checked_at: z.string().nullable().catch(null),
});
export type LenientSelfCheck = z.infer<typeof LenientSelfCheckSchema>;

type Supports = "authentic" | "inauthentic" | "protocol_ok" | "protocol_issue" | "context" | "neutral";
type Strength = "strong" | "moderate" | "weak";

export const LenientEvidenceItemSchema = z.object({
  claim: z.string(),
  supports: openString<Supports>(),
  strength: openString<Strength>(),
  citation: LenientCitationSchema.nullable().catch(null),
});
export type LenientEvidenceItem = z.infer<typeof LenientEvidenceItemSchema>;

/** No verdict field, on purpose: zod strips any extra key the server might add. */
export const LenientReviewBriefSchema = z.object({
  submission_id: z.string(),
  summary: z.string(),
  evidence: lenientArray(LenientEvidenceItemSchema),
  uncertainties: lenientArray(z.string()),
  suggested_checks: lenientArray(z.string()),
  injection_flags: lenientArray(z.string()),
  source: openString<"grok" | "template">().catch("grok"),
  generated_at: z.string().nullable().catch(null),
});
export type LenientReviewBrief = z.infer<typeof LenientReviewBriefSchema>;

export const LenientSponsorImpactSchema = z.object({
  sponsor_id: z.string(),
  sponsor_name: z.string(),
  period_from: z.string(),
  period_to: z.string(),
  // Money and counts are required: a made-up 0 in an impact report would be a false statement.
  contributed_cents: z.number(),
  spent_cents: z.number(),
  observations_accepted: z.number(),
  cells_covered: z.number(),
  requests_funded: z.number(),
  highlights: lenientArray(z.string()),
  narrative: LenientGrokbotMessageSchema.nullable().catch(null),
});
export type LenientSponsorImpact = z.infer<typeof LenientSponsorImpactSchema>;

export const LenientRadarFundingSchema = z.object({
  fundable: z.boolean(),
  estimated_allocation_cents: z.number().catch(0),
  reason: z.string().catch(""),
});
export type LenientRadarFunding = z.infer<typeof LenientRadarFundingSchema>;

/** Radar drafts gain optional `funding` (additive). An unreadable funding block → no funding info. */
export const RadarDraftSchema = DraftBountySchema.extend({
  funding: LenientRadarFundingSchema.nullable().optional().catch(undefined),
});
export type RadarDraft = z.infer<typeof RadarDraftSchema>;
export const LenientRadarScanResponseSchema = RadarScanResponseSchema.extend({ drafts: lenientArray(RadarDraftSchema) });

/** Public funding sponsors, plus the `id` the public impact link needs (optional until the server sends it). */
export const LenientPublicFundingSchema = PublicFundingResponseSchema.extend({
  sponsors: lenientArray(PublicFundingResponseSchema.shape.sponsors.element.extend({ id: z.string().optional().catch(undefined) })),
});
export type LenientPublicFunding = z.infer<typeof LenientPublicFundingSchema>;

// ---------------------------------------------------------------- errors

export interface GrokbotErrorView {
  message: string;
  /** "info" = the feature isn't on this server yet (not a failure the user caused or can fix). */
  tone: "info" | "danger";
  retry: boolean;
}

export const GROKBOT_UNAVAILABLE = "Grok explanations aren't available on this server yet. Everything else works as usual.";

/**
 * Grokbot error → words. A 404 with no API error body means the route doesn't exist yet (the server
 * ships these endpoints separately); 501 means it exists but is switched off. Both are shown as a
 * calm info notice, not an error. A real NOT_FOUND (the record is gone) keeps the shared copy.
 */
export function grokbotError(e: unknown): GrokbotErrorView {
  if (e instanceof ApiClientError) {
    if (e.status === 501 || e.code === "NOT_IMPLEMENTED" || (e.status === 404 && e.code === "http_error")) {
      return { message: GROKBOT_UNAVAILABLE, tone: "info", retry: false };
    }
    if (e.status === 504) return { message: "Grok took too long to answer. Try again in a minute.", tone: "danger", retry: true };
  }
  return { message: errorMessage(e), tone: "danger", retry: true };
}

// ---------------------------------------------------------------- citations → plain language

const humanize = (s: string) => {
  const w = s.replace(/[_-]+/g, " ").trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "";
};

/** Researcher-facing names for reason codes (researchers may see which check fired; contributors never do). */
export const REASON_NAMES: Record<string, string> = {
  SESSION_INVALID: "Capture session not valid",
  SESSION_EXPIRED: "Capture session expired",
  OUTSIDE_AREA: "Outside the request area",
  CHALLENGE_FAILED: "Anti-fake challenge not shown",
  BLURRY: "Blurry photo",
  TOO_DARK: "Too dark",
  BAD_FRAMING: "Poor framing",
  SCREEN_RECAPTURE: "Looks like a photo of a screen",
  PRINTED_PHOTO: "Looks like a printed photo",
  AI_GENERATED_SUSPECTED: "Possibly AI-generated",
  EDITED_SUSPECTED: "Possibly edited",
  DUPLICATE: "Duplicate of an earlier capture",
  VELOCITY_LIMIT: "Too many captures too quickly",
  IMPOSSIBLE_TRAVEL: "Impossible travel between captures",
  WEATHER_IMPLAUSIBLE: "Weather doesn't match",
  DAYLIGHT_MISMATCH: "Daylight doesn't match the time",
  LOW_TRUST_REVIEW: "New or low-trust contributor",
  LOW_CONFIDENCE: "Low model confidence",
  STAGE_ERROR: "A check couldn't run",
  SYNTHETIC_MEDIA: "Synthetic media",
  C2PA_AI_GENERATED: "Metadata says AI-generated",
  DEMO_WAIVER: "Check waived (demo)",
  GATE_DEGRADED: "Live scene check in limited mode",
  HAZARD_PAUSED: "Paused for a hazard warning",
  REVIEWER_REJECTED: "Rejected by a reviewer",
  BUDGET_EXHAUSTED: "Budget exhausted",
  OUTSIDE_WINDOW: "Outside the time window",
  OFF_TOPIC: "Not the requested subject",
  GATE_NOT_PASSED: "Live scene check never passed",
  EXTRACTION_MISSING: "Measurement missing",
  EXTRACTION_IMPLAUSIBLE: "Measurement implausible",
  EXTRACTION_LOW_CONFIDENCE: "Measurement uncertain",
};

export function reasonName(code: string): string {
  if (code.startsWith("MISSING_ELEMENT:")) return `Missing from frame: ${humanize(code.slice("MISSING_ELEMENT:".length)).toLowerCase()}`;
  return REASON_NAMES[code] ?? (humanize(code.toLowerCase()) || "Finding");
}

const KIND_LABEL: Record<CitationKind, string> = {
  stage: "Check",
  reason_code: "Finding",
  extracted_field: "Measured value",
  price_reason: "Price factor",
  pool: "Sponsor pool",
  protocol: "Protocol",
  profile: "Profile",
  alert: "Alert",
  observation: "Observation",
};

/** "depth_cm" → "Depth (cm)"; other snake_case → sentence case. */
function fieldName(ref: string): string {
  const m = /^(.*)_(cm|mm|m|km|kg|g|ml|l|pct|percent|c|f)$/i.exec(ref);
  if (m && m[1]) return `${humanize(m[1])} (${m[2] === "pct" || m[2] === "percent" ? "%" : m[2]!.toLowerCase()})`;
  return humanize(ref) || ref;
}

export interface CitationView {
  kind: string;
  text: string;
  detail: string | null;
}

/** A citation as a reader sees it: stage → its label, reason code → friendly name, price reason as-is. */
export function citationView(c: LenientCitation): CitationView {
  const kind = KIND_LABEL[c.kind as CitationKind] ?? (humanize(c.kind) || "Source");
  let text: string;
  switch (c.kind) {
    case "stage":
      text = stageLabel(c.ref);
      break;
    case "reason_code":
      text = reasonName(c.ref);
      break;
    case "extracted_field":
      text = fieldName(c.ref);
      break;
    default:
      text = c.ref;
  }
  const detail = c.detail?.trim() ? c.detail.trim() : null;
  return { kind, text, detail };
}

/** Citations for the Sources list, de-duplicated by what the reader would see. */
export function citationViews(cs: readonly LenientCitation[]): CitationView[] {
  const seen = new Set<string>();
  const out: CitationView[] = [];
  for (const c of cs) {
    const v = citationView(c);
    const key = `${v.kind}|${v.text}|${v.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Only an explicit "template" earns the badge; any other value (including a newer one) is model text. */
export const isTemplate = (m: { source: string }): boolean => m.source === "template";

// ---------------------------------------------------------------- Studio self-check

export type Tone = "success" | "warning" | "danger" | "info" | "muted" | "progress";

export const VERDICT_META: Record<Verdict, { label: string; tone: Tone }> = {
  ok: { label: "Detectable", tone: "success" },
  weak: { label: "Weak", tone: "warning" },
  undetectable: { label: "Not detected", tone: "danger" },
};

export function verdictMeta(v: string): { label: string; tone: Tone } {
  return VERDICT_META[v as Verdict] ?? { label: humanize(v) || "Unknown", tone: "muted" };
}

export interface PublishDecision {
  confirm: boolean;
  /** One-line concern for the confirm dialog (null when there's nothing to confirm). */
  concern: string | null;
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Whether Publish should ask first. Only an explicit "revise" does; the researcher always decides,
 * so this never blocks. No self-check, "ready", or an unknown overall → publish as before.
 */
export function publishDecision(check: LenientSelfCheck | null): PublishDecision {
  if (!check || check.overall !== "revise") return { confirm: false, concern: null };
  const missing = check.elements.filter((e) => e.verdict === "undetectable").map((e) => e.label.toLowerCase());
  const weak = check.elements.filter((e) => e.verdict === "weak").map((e) => e.label.toLowerCase());
  let concern: string;
  if (missing.length) concern = `Grok thinks the camera may not detect: ${list(missing)}.`;
  else if (weak.length) concern = `Grok thinks the camera may only weakly detect: ${list(weak)}.`;
  else if (check.relevance_ok === false) concern = "Grok thinks the example scene may not be recognized as this protocol's subject.";
  else if (check.suggestions[0]) concern = `Grok suggests a revision: ${check.suggestions[0]}`;
  else concern = "Grok suggests revising this protocol before publishing.";
  return { confirm: true, concern };
}

/** Progress copy by elapsed time (no streaming from the server). */
export function selfCheckStage(elapsedMs: number): string {
  const s = elapsedMs / 1000;
  if (s < 8) return "Preparing the example image…";
  if (s < 25) return "Running the live frame check on the example…";
  if (s < 45) return "Checking each required element and the subject…";
  return "Still checking. Generating a new example image can take a little longer.";
}

export type SelfCheckJob =
  | { status: "running"; startedAt: number }
  | { status: "done"; result: LenientSelfCheck; finishedAt: number }
  | { status: "error"; error: GrokbotErrorView };

const selfChecks = new Map<string, SelfCheckJob>();
const selfCheckListeners = new Set<() => void>();
let selfCheckVersion = 0;

function setSelfCheck(id: string, j: SelfCheckJob | null): void {
  if (j) selfChecks.set(id, j);
  else selfChecks.delete(id);
  selfCheckVersion++;
  for (const l of selfCheckListeners) l();
}

export function getSelfCheck(protocolId: string): SelfCheckJob | null {
  return selfChecks.get(protocolId) ?? null;
}

/** For useSyncExternalStore: changes whenever any self-check job changes. */
export const selfCheckSnapshot = (): number => selfCheckVersion;

export function subscribeSelfChecks(fn: () => void): () => void {
  selfCheckListeners.add(fn);
  return () => selfCheckListeners.delete(fn);
}

/**
 * Starts a self-check for a protocol unless one is running for it. Lives outside React so the
 * researcher can leave the Studio and come back (it takes ~30–60 s), like the draft job.
 */
export function startSelfCheck(protocolId: string, run: (id: string) => Promise<LenientSelfCheck>): boolean {
  if (selfChecks.get(protocolId)?.status === "running") return false;
  setSelfCheck(protocolId, { status: "running", startedAt: Date.now() });
  run(protocolId).then(
    (result) => setSelfCheck(protocolId, { status: "done", result, finishedAt: Date.now() }),
    (e: unknown) => setSelfCheck(protocolId, { status: "error", error: grokbotError(e) }),
  );
  return true;
}

export function clearSelfCheck(protocolId: string): void {
  if (selfChecks.get(protocolId)?.status !== "running") setSelfCheck(protocolId, null);
}

// ---------------------------------------------------------------- Radar funding

/** Fundable first, then drafts without funding info, then pending; stable within each group. */
export function sortRadarDrafts<T extends { funding?: LenientRadarFunding | null }>(drafts: readonly T[]): T[] {
  const rank = (d: T) => (d.funding ? (d.funding.fundable ? 0 : 2) : 1);
  return drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
    .map((x) => x.d);
}

// ---------------------------------------------------------------- reviewer brief

/**
 * Evidence groups in display order. Labels describe what the evidence bears on, never an outcome:
 * the brief summarizes, the reviewer decides.
 */
export const EVIDENCE_GROUPS: readonly { id: Supports | "other"; label: string }[] = [
  { id: "authentic", label: "Points toward a real capture" },
  { id: "inauthentic", label: "Raises authenticity questions" },
  { id: "protocol_ok", label: "Matches the protocol" },
  { id: "protocol_issue", label: "Protocol gaps" },
  { id: "context", label: "Context" },
  { id: "neutral", label: "Other observations" },
];

const STRENGTH_ORDER: Record<string, number> = { strong: 0, moderate: 1, weak: 2 };

export const STRENGTH_META: Record<Strength, { label: string; tone: Tone }> = {
  strong: { label: "Strong", tone: "info" },
  moderate: { label: "Moderate", tone: "muted" },
  weak: { label: "Weak", tone: "muted" },
};

export function strengthMeta(s: string): { label: string; tone: Tone } {
  return STRENGTH_META[s as Strength] ?? { label: humanize(s) || "Unrated", tone: "muted" };
}

export interface EvidenceGroup {
  id: string;
  label: string;
  items: LenientEvidenceItem[];
}

/** Evidence grouped by what it supports (unknown kinds join "Other observations"), strongest first. */
export function groupEvidence(items: readonly LenientEvidenceItem[]): EvidenceGroup[] {
  const known = new Set(EVIDENCE_GROUPS.map((g) => g.id));
  const by = new Map<string, LenientEvidenceItem[]>();
  for (const it of items) {
    const id = known.has(it.supports as Supports) ? it.supports : "neutral";
    by.set(id, [...(by.get(id) ?? []), it]);
  }
  return EVIDENCE_GROUPS.flatMap((g) => {
    const xs = by.get(g.id);
    if (!xs?.length) return [];
    const sorted = xs
      .map((x, i) => ({ x, i }))
      .sort((a, b) => (STRENGTH_ORDER[a.x.strength] ?? 3) - (STRENGTH_ORDER[b.x.strength] ?? 3) || a.i - b.i)
      .map((y) => y.x);
    return [{ id: g.id, label: g.label, items: sorted }];
  });
}

// ---------------------------------------------------------------- sponsor impact

export type ImpactPeriod = "30d" | "90d" | "ytd" | "all";
export const IMPACT_PERIODS: readonly { id: ImpactPeriod; label: string }[] = [
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "all", label: "All time" },
];

/** Query range for a period. "all" sends no bounds (the server defaults to everything). */
export function impactRange(p: ImpactPeriod, now: Date = new Date()): { from?: string; to?: string } {
  const to = now.toISOString();
  const day = 86_400_000;
  switch (p) {
    case "30d":
      return { from: new Date(now.getTime() - 30 * day).toISOString(), to };
    case "90d":
      return { from: new Date(now.getTime() - 90 * day).toISOString(), to };
    case "ytd":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to };
    default:
      return {};
  }
}

export const publicImpactPath = (sponsorId: string) => `/funding/sponsors/${encodeURIComponent(sponsorId)}`;

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => (Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toISOString().slice(0, 10));

/** Plain-text report for the copy/share button: aggregates and the narrative, nothing per-person. */
export function impactShareText(r: LenientSponsorImpact, publicUrl?: string): string {
  const lines = [
    `${r.sponsor_name} — GroundTruth impact report (${day(r.period_from)} to ${day(r.period_to)})`,
    "",
    `Contributed: ${money(r.contributed_cents)}`,
    `Paid to contributors: ${money(r.spent_cents)}`,
    `Verified observations: ${r.observations_accepted.toLocaleString("en-US")}`,
    `Map cells covered: ${r.cells_covered.toLocaleString("en-US")}`,
    `Data requests funded: ${r.requests_funded.toLocaleString("en-US")}`,
  ];
  if (r.highlights.length) lines.push("", ...r.highlights.map((h) => `• ${h}`));
  if (r.narrative) lines.push("", r.narrative.headline, ...r.narrative.paragraphs);
  if (publicUrl) lines.push("", publicUrl);
  lines.push("", "Figures are simulated during the pilot.");
  return lines.join("\n");
}
