/**
 * Role-scoped case files: the only facts Grokbot may see or cite, built from the database.
 *
 * - contributor (their own submission): status, payout, the protocol's required elements and tips,
 *   protocol/context-kind reasons with their contributor wording, non-integrity stage statuses. NO
 *   integrity codes, integrity stage results, evidence strings, scores, trust, or other users. An
 *   integrity reject collapses to the single neutral fact (NEUTRAL_INTEGRITY_MESSAGE semantics,
 *   same rule as the phone's resultView: any integrity code → neutral).
 * - researcher/admin (a submission on a bounty they manage): every stage with status/score/codes and
 *   evidence, scores, extracted numbers, the contributor's trust score (no identity); contributor
 *   text (field notes, extracted notes) goes to `untrusted`, screened for prompt injection.
 * - bounty status (owner/admin): allocation, spend, pacing, the allocator's own reason, pool totals.
 * - price (anyone who can see the bounty): price, surge, public reasons, public base/ceiling. Never
 *   the engine's factors or weights.
 * - sponsor impact: aggregates only (see impact.ts).
 */
import {
  NEUTRAL_INTEGRITY_MESSAGE,
  STAGES,
  contributorMessage,
  isIntegrityCode,
  reasonKind,
  stageLabel,
  type Protocol,
  type ReasonCode,
  type StageResult,
} from "@groundtruth/shared";
import type { SubmissionRecord } from "../db/repos/submissions";
import { screenUntrusted } from "./injection";
import type { CaseFile, Fact } from "./types";

export const dollars = (c: number): string => `$${(c / 100).toFixed(2)}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Stages whose results reveal which anti-cheating check fired. Never shown to contributors. */
export const INTEGRITY_STAGES = new Set<string>(["session_integrity", "challenge", "authenticity", "duplicates"]);

export const TERMINAL = new Set(["accepted", "rejected", "needs_review"]);

export interface SubmissionCaseInput {
  submission: SubmissionRecord;
  protocol: Protocol;
  bountyTitle: string;
  /** researcher/admin views only. */
  contributorTrust?: number | null;
}

function protocolFacts(p: Protocol): Fact[] {
  const facts: Fact[] = [
    {
      id: "protocol",
      citation: { kind: "protocol", ref: p.slug, detail: p.name },
      text: clip(`The bounty uses the "${p.name}" protocol: ${p.why_it_matters}`, 300),
    },
  ];
  for (const e of p.capture.required_elements) {
    facts.push({
      id: `element.${e.id}`,
      citation: { kind: "protocol", ref: `element:${e.id}`, detail: e.label },
      text: clip(`Required in the shot: ${e.label} (${e.description})`, 300),
    });
  }
  if (p.capture.framing_tips.length) {
    facts.push({
      id: "protocol.tips",
      citation: { kind: "protocol", ref: "framing_tips", detail: null },
      text: clip(`Framing tips: ${p.capture.framing_tips.join(" ")}`, 300),
    });
  }
  return facts;
}

function statusFact(s: SubmissionRecord): Fact {
  return { id: "status", citation: { kind: "observation", ref: "status", detail: s.status }, text: `This capture's status is ${s.status.replace("_", " ")}.` };
}

/** Does this submission's outcome collapse to the neutral integrity message for its contributor? */
export function isNeutralForContributor(s: Pick<SubmissionRecord, "status" | "reason_codes">): boolean {
  return s.status === "rejected" && (s.reason_codes.length === 0 || s.reason_codes.some(isIntegrityCode));
}

function elementLabel(p: Protocol, code: string): string | undefined {
  if (!code.startsWith("MISSING_ELEMENT:")) return undefined;
  return p.capture.required_elements.find((e) => e.id === code.slice("MISSING_ELEMENT:".length))?.label;
}

export function contributorSubmissionCase(i: SubmissionCaseInput, kind = "explain"): CaseFile {
  const s = i.submission;
  const facts: Fact[] = [statusFact(s), { id: "bounty", citation: { kind: "observation", ref: "bounty", detail: null }, text: clip(`Bounty: ${i.bountyTitle}.`, 200) }];
  if (isNeutralForContributor(s)) {
    facts.push({ id: "code.neutral", citation: { kind: "reason_code", ref: "NOT_VERIFIED", detail: NEUTRAL_INTEGRITY_MESSAGE }, text: NEUTRAL_INTEGRITY_MESSAGE });
    return { kind, subjectId: s.id, audience: "contributor", facts, untrusted: [], injectionFlags: [] };
  }
  facts.push(...protocolFacts(i.protocol));
  if (s.status === "accepted" && s.payout_cents !== null) {
    facts.push({ id: "payout", citation: { kind: "observation", ref: "payout_cents", detail: dollars(s.payout_cents) }, text: `The payout for this capture is ${dollars(s.payout_cents)}.` });
  }
  // Contributor-visible reasons: never integrity codes (a needs_review row can carry them too).
  const codes = s.reason_codes.filter((c) => !isIntegrityCode(c) && reasonKind(c) !== "info");
  for (const code of codes) {
    facts.push({
      id: `code.${code}`,
      citation: { kind: "reason_code", ref: code, detail: null },
      text: contributorMessage(code as ReasonCode, elementLabel(i.protocol, code), i.protocol),
    });
  }
  for (const c of s.checks) {
    if (INTEGRITY_STAGES.has(c.stage) || c.status === "pending" || c.status === "running") continue;
    facts.push({
      id: `stage.${c.stage}`,
      citation: { kind: "stage", ref: c.stage, detail: c.status },
      text: `${stageLabel(c.stage, c.label)} check: ${c.status}.`,
    });
  }
  if (s.status === "accepted" && s.extracted) {
    for (const [k, v] of Object.entries(s.extracted)) {
      if (typeof v !== "number" || /confidence/.test(k)) continue;
      facts.push({ id: `field.${k}`, citation: { kind: "extracted_field", ref: k, detail: String(v) }, text: `Recorded ${k.replace(/_/g, " ")}: ${v}.` });
    }
  }
  return { kind, subjectId: s.id, audience: "contributor", facts, untrusted: [], injectionFlags: [] };
}

function stageFact(c: StageResult): Fact {
  const bits = [`${stageLabel(c.stage, c.label)}: ${c.status}`];
  if (c.score !== null) bits.push(`score ${c.score.toFixed(2)}`);
  if (c.reasonCodes.length) bits.push(`codes ${c.reasonCodes.join(", ")}`);
  const ev = c.evidence.slice(0, 3).map((e) => clip(e, 160));
  return {
    id: `stage.${c.stage}`,
    citation: { kind: "stage", ref: c.stage, detail: c.status },
    text: clip(`${bits.join("; ")}.${ev.length ? ` Evidence: ${ev.join(" / ")}` : ""}`, 600),
  };
}

export function researcherSubmissionCase(i: SubmissionCaseInput, audience: "researcher" | "admin", kind = "explain"): CaseFile {
  const s = i.submission;
  const facts: Fact[] = [statusFact(s), ...protocolFacts(i.protocol)];
  facts.push({ id: "verifier", citation: { kind: "observation", ref: "verifier", detail: s.verifier }, text: `Decided by: ${s.verifier}.` });
  if (s.confidence !== null) facts.push({ id: "confidence", citation: { kind: "observation", ref: "confidence", detail: null }, text: `Overall confidence ${s.confidence.toFixed(2)}.` });
  if (s.protocol_score !== null) facts.push({ id: "protocol_score", citation: { kind: "observation", ref: "protocol_score", detail: null }, text: `Protocol score ${s.protocol_score.toFixed(2)} (minimum ${i.protocol.acceptance.min_protocol_score}).` });
  if (s.authenticity_score !== null) facts.push({ id: "authenticity_score", citation: { kind: "observation", ref: "authenticity_score", detail: null }, text: `Authenticity score ${s.authenticity_score.toFixed(2)} (minimum ${i.protocol.acceptance.min_authenticity_score}).` });
  if (s.payout_cents !== null) facts.push({ id: "payout", citation: { kind: "observation", ref: "payout_cents", detail: dollars(s.payout_cents) }, text: `Payout ${dollars(s.payout_cents)}.` });
  if (typeof i.contributorTrust === "number") facts.push({ id: "trust", citation: { kind: "profile", ref: "trust_score", detail: null }, text: `Contributor trust score ${i.contributorTrust.toFixed(2)} (0 to 1).` });
  const gate = s.gate as Partial<{ degraded: boolean; frame_checks: number; consecutive_green: number }>;
  if (typeof gate.frame_checks === "number") {
    facts.push({
      id: "gate",
      citation: { kind: "observation", ref: "gate", detail: gate.degraded ? "degraded" : null },
      text: `Phone capture gate: ${gate.frame_checks} live frame checks, ${gate.consecutive_green ?? 0} consecutive all-green${gate.degraded ? ", ran in degraded mode" : ""}.`,
    });
  }
  for (const code of s.reason_codes) {
    facts.push({ id: `code.${code}`, citation: { kind: "reason_code", ref: code, detail: reasonKind(code) }, text: `Reason code ${code} (${reasonKind(code)}).` });
  }
  for (const c of s.checks) if (c.status !== "pending") facts.push(stageFact(c));
  const texts: { source: string; text: string }[] = [];
  for (const [k, v] of Object.entries(s.field_notes ?? {})) {
    if (typeof v === "string") texts.push({ source: `field_notes.${k}`, text: v });
    else if (v !== null) facts.push({ id: `note.${k}`, citation: { kind: "observation", ref: `field_notes.${k}`, detail: String(v) }, text: `Contributor answered ${k.replace(/_/g, " ")}: ${String(v)}.` });
  }
  for (const [k, v] of Object.entries(s.extracted ?? {})) {
    if (typeof v === "number") facts.push({ id: `field.${k}`, citation: { kind: "extracted_field", ref: k, detail: String(v) }, text: `Extracted ${k}: ${v}.` });
    else if (typeof v === "string") texts.push({ source: `extracted.${k}`, text: v }); // may echo text read from the image
    else if (typeof v === "boolean") facts.push({ id: `field.${k}`, citation: { kind: "extracted_field", ref: k, detail: String(v) }, text: `Extracted ${k}: ${v}.` });
  }
  const { untrusted, flags } = screenUntrusted(texts);
  return { kind, subjectId: s.id, audience, facts, untrusted, injectionFlags: flags };
}

/** Stage ids in pipeline order (for narration). */
export const STAGE_ORDER = STAGES.map((s) => s.id);

