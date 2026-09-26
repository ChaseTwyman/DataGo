/**
 * What the phone renders from a GrokbotMessage (explain, final narration, price-why). Pure,
 * unit-tested. The server role-scopes every message; these helpers only add defense in depth:
 * - integrity rejects render the fixed neutral card — no server text, no citations (like resultView);
 * - reason-code citations for integrity codes are dropped everywhere;
 * - citations are turned into plain-language sentences, never raw kinds/refs.
 */
import { contributorMessage, isIntegrityCode, isKnownReasonCode, NEUTRAL_INTEGRITY_MESSAGE, stageLabel } from "@groundtruth/shared";
import { toUserMessage } from "../api/errors";
import { isUnsupported } from "./narrationPoller";
import type { LenientCitation, LenientGrokbotMessage } from "./schemas";

export interface GrokbotCardView {
  headline: string;
  paragraphs: string[];
  nextSteps: string[];
  /** Plain-language "why?" lines (deduped). Empty → no expander. */
  why: string[];
  /** "template" = written by the deterministic fallback (shown as a quiet note). */
  templated: boolean;
}

const tidy = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** One citation as a sentence a contributor understands, or null to leave it out. */
export function citationText(c: LenientCitation): string | null {
  const ref = tidy(c.ref);
  const detail = tidy(c.detail);
  const withDetail = (lead: string) => (detail ? `${lead}: ${detail}` : lead);
  switch (c.kind) {
    case "stage":
      return ref ? withDetail(`Check “${stageLabel(ref)}”`) : null;
    case "reason_code": {
      if (!ref || isIntegrityCode(ref) || !isKnownReasonCode(ref)) return null;
      return contributorMessage(ref);
    }
    case "extracted_field":
      return ref ? withDetail(`What we read from your photo (${ref.replace(/[_-]+/g, " ")})`) : null;
    case "price_reason":
      return ref ? `Price factor: ${ref}` : null;
    case "pool":
      return withDetail("How the sponsor pool is funding this area");
    case "protocol":
      return withDetail("The bounty's capture instructions");
    case "profile":
      return withDetail("Your profile");
    case "alert":
      return withDetail("An active weather or hazard alert here");
    case "observation":
      return withDetail("Other readings nearby");
    default:
      // A newer kind this build doesn't know: say only that there is a stored fact behind it.
      return detail || null;
  }
}

/** What an integrity reject shows and says, whatever the server's message: nothing check-specific. */
export const NEUTRAL_INTEGRITY_CARD: GrokbotCardView = {
  headline: NEUTRAL_INTEGRITY_MESSAGE,
  paragraphs: [],
  nextSteps: ["You can start a new capture from any bounty nearby."],
  why: [],
  templated: false,
};

export function grokbotCardView(m: LenientGrokbotMessage, opts: { integrityReject?: boolean } = {}): GrokbotCardView {
  // Same rule as resultView(): integrity rejects never render server text (defense in depth — a
  // role-scoping bug on the server must not become a lesson in beating verification).
  if (opts.integrityReject) return NEUTRAL_INTEGRITY_CARD;
  const why = [...new Set(m.citations.map(citationText).filter((s): s is string => !!s))];
  return {
    headline: tidy(m.headline),
    paragraphs: m.paragraphs.map(tidy).filter(Boolean),
    nextSteps: m.next_steps.map(tidy).filter(Boolean),
    why,
    templated: m.source === "template",
  };
}

/** "Why this price?": the server's grounded message, or the bounty's own reasons as a fallback. */
export type PriceWhyView =
  | { kind: "message"; card: GrokbotCardView }
  | { kind: "local"; reasons: string[] }
  | { kind: "none"; text: string };

export function priceWhyView(result: { ok: true; message: LenientGrokbotMessage } | { ok: false; error: unknown }, localReasons: readonly string[] | null | undefined): PriceWhyView {
  if (result.ok) return { kind: "message", card: grokbotCardView(result.message) };
  const reasons = [...new Set((localReasons ?? []).map(tidy).filter(Boolean))];
  if (reasons.length) return { kind: "local", reasons };
  return { kind: "none", text: "The price follows how many readings this area still needs, how recent the event is, and how much budget is left." };
}

/**
 * For-you match reason as shown: "Good fit: your civil-engineering background…". Null when there's
 * nothing to say. The server's sentence is kept verbatim apart from the lead-in.
 */
export function matchReasonText(reason: string | null | undefined): string | null {
  const r = tidy(reason);
  if (!r) return null;
  if (/^good fit\b/i.test(r)) return r;
  // Lower-case only a leading "You/Your" (never names or acronyms like "GIS", "Atlanta").
  return `Good fit: ${/^(You|Your)\b/.test(r) ? r.charAt(0).toLowerCase() + r.slice(1) : r}`;
}

/** Explain failed: friendly copy only. 404/501 = not deployed yet (or nothing to explain). */
export function explainErrorText(e: unknown): string {
  if (isUnsupported(e)) return "An explanation isn't available for this capture yet. Check back later.";
  return toUserMessage(e).message;
}
