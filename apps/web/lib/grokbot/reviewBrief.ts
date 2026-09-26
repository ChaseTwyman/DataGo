/**
 * Phase 5: reviewer brief (researcher owner / admin). Evidence with citations and strength,
 * uncertainties, suggested manual checks, injection flags. Deliberately NO verdict: the schema has no
 * field for one, the prompt forbids one, and every line that reads like a verdict or recommendation
 * ("approve", "reject", "recommend", "should be paid") is dropped after generation. The human
 * reviewer decides on the existing review endpoint.
 */
import { closeObjects, ReviewBriefSchema, type JsonSchema, type ReviewBrief } from "@groundtruth/shared";
import { z } from "zod";
import type { Db } from "../db";
import { grokEnv, isMockGrok } from "../grok/config";
import { grokJSON } from "../grok/json";
import { cacheGet, cachePut, caseVersion } from "./cache";
import { INTEGRITY_STAGES } from "./caseFile";
import { groundDraft, systemPrompt, userContent, type Generate } from "./compose";
import { MANUAL_CHECKS } from "./templates";
import type { CaseFile, DraftLine } from "./types";

/** Anything that reads as a decision or a recommendation. Never reaches a reviewer. */
export const VERDICT_RE =
  /\b(approv\w*|reject\w*|recommend\w*|verdict\w*|should (be )?(accept|pay|paid|approve|reject|decline)\w*|(accept|decline|pay) (this|it|the (capture|submission|observation))|i (would|suggest you) (accept|pay|approve|reject))\b/i;

type Supports = ReviewBrief["evidence"][number]["supports"];
type Strength = ReviewBrief["evidence"][number]["strength"];

const EvidenceModel = z.object({
  claim: z.string(),
  supports: z.enum(["authentic", "inauthentic", "protocol_ok", "protocol_issue", "context", "neutral"]),
  strength: z.enum(["strong", "moderate", "weak"]),
  fact_id: z.string(),
});
const LineModel = z.object({ text: z.string(), cites: z.array(z.string()) });
/** What the model may return. No verdict, decision, or recommendation field exists to fill. */
export const BriefModelSchema = z.object({
  summary: LineModel,
  evidence: z.array(EvidenceModel).max(12),
  uncertainties: z.array(LineModel).max(6),
  suggested_checks: z.array(LineModel).max(6),
});
export type BriefModel = z.infer<typeof BriefModelSchema>;

export function briefJsonSchema(): JsonSchema {
  const js = z.toJSONSchema(BriefModelSchema) as JsonSchema;
  delete js.$schema;
  return closeObjects(js);
}

const TASK = [
  "Prepare a brief for the human reviewer of this capture.",
  "List the evidence for and against it being genuine and meeting the protocol, each item tied to one fact id, labeled with what it supports and how strong it is.",
  "List what is uncertain and concrete manual checks the reviewer can do.",
  "Do NOT give a verdict, a recommendation, or a decision, and do not say whether to accept, approve, reject, or pay: the reviewer decides.",
].join(" ");

function stageSupport(stage: string, status: string): { supports: Supports; strength: Strength } {
  if (status === "error" || status === "skipped" || status === "waived") return { supports: "neutral", strength: "weak" };
  if (INTEGRITY_STAGES.has(stage)) {
    if (status === "pass") return { supports: "authentic", strength: "moderate" };
    return { supports: "inauthentic", strength: status === "fail" ? "strong" : "weak" };
  }
  if (stage === "relevance" || stage === "protocol") {
    if (status === "pass") return { supports: "protocol_ok", strength: "moderate" };
    return { supports: "protocol_issue", strength: status === "fail" ? "strong" : "weak" };
  }
  return { supports: "context", strength: status === "pass" ? "moderate" : "weak" };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Adds the derived "stages at a glance" fact the summary cites. */
export function withStageSummary(c: CaseFile): CaseFile {
  const stages = c.facts.filter((f) => f.id.startsWith("stage."));
  const count = (re: RegExp) => stages.filter((f) => re.test(f.citation.detail ?? "")).length;
  const text = `Stages: ${count(/^pass$/)} passed, ${count(/^(fail|warn)$/)} flagged, ${count(/^(error|skipped|waived)$/)} not judged.`;
  return { ...c, facts: [...c.facts, { id: "stages.summary", citation: { kind: "stage", ref: "summary", detail: null }, text }] };
}

export function briefTemplate(c: CaseFile): BriefModel {
  const stageFacts = c.facts.filter((f) => f.id.startsWith("stage."));
  const evidence = stageFacts.map((f) => {
    const s = stageSupport(f.citation.ref, f.citation.detail ?? "");
    return { claim: clip(f.text, 300), ...s, fact_id: f.id };
  });
  const uncertainties: DraftLine[] = stageFacts
    .filter((f) => /^(error|skipped|warn)$/.test(f.citation.detail ?? ""))
    .map((f) => ({ text: clip(`${f.text.split(";")[0]!.split(".")[0]} was not conclusive.`, 240), cites: [f.id] }));
  if (c.injectionFlags.length && c.facts.some((f) => f.id === "status")) {
    uncertainties.push({ text: "Some contributor text looked like instructions to an AI; it was ignored.", cites: ["status"] });
  }
  const suggested: DraftLine[] = c.facts
    .filter((f) => f.id.startsWith("code.") && MANUAL_CHECKS[f.citation.ref])
    .map((f) => ({ text: MANUAL_CHECKS[f.citation.ref]!, cites: [f.id] }));
  const elements = c.facts.filter((f) => f.id.startsWith("element."));
  if (elements.length) suggested.push({ text: "Check each required element is clearly visible in the photos.", cites: elements.map((e) => e.id) });
  return {
    summary: { text: c.facts.find((f) => f.id === "stages.summary")?.text ?? "Brief for this capture.", cites: ["stages.summary"] },
    evidence: evidence.slice(0, 12),
    uncertainties: uncertainties.slice(0, 6),
    suggested_checks: suggested.slice(0, 6),
  };
}

const noVerdict = (s: string) => !VERDICT_RE.test(s);

/** Grounds and de-verdicts model output; null when no evidence survives. */
export function groundBrief(m: BriefModel, c: CaseFile): BriefModel | null {
  const ids = new Set(c.facts.map((f) => f.id));
  const lines = (arr: DraftLine[]) => {
    const g = groundDraft({ headline: { text: "", cites: [] }, paragraphs: arr.filter((l) => noVerdict(l.text)), next_steps: [] }, c);
    return g.draft?.paragraphs ?? [];
  };
  const evidence = m.evidence.filter(
    (e) => ids.has(e.fact_id) && noVerdict(e.claim) && lines([{ text: e.claim, cites: [e.fact_id] }]).length === 1,
  );
  if (evidence.length === 0) return null;
  const summary = lines([m.summary])[0] ?? briefTemplate(c).summary;
  return { summary, evidence, uncertainties: lines(m.uncertainties), suggested_checks: lines(m.suggested_checks) };
}

export function toBrief(submissionId: string, m: BriefModel, c: CaseFile, source: "grok" | "template", now = new Date()): ReviewBrief {
  const scrub = (s: string, n: number) => clip(s.trim(), n);
  return ReviewBriefSchema.parse({
    submission_id: submissionId,
    summary: scrub(m.summary.text, 600),
    evidence: m.evidence.slice(0, 20).map((e) => ({
      claim: scrub(e.claim, 300),
      supports: e.supports,
      strength: e.strength,
      citation: c.facts.find((f) => f.id === e.fact_id)!.citation,
    })),
    uncertainties: m.uncertainties.slice(0, 8).map((u) => scrub(u.text, 240)),
    suggested_checks: m.suggested_checks.slice(0, 6).map((u) => scrub(u.text, 240)),
    injection_flags: c.injectionFlags.slice(0, 5),
    source,
    generated_at: now.toISOString(),
  });
}

export const defaultBriefGenerate: Generate = ({ op, system, user, mock }) =>
  grokJSON({
    op,
    model: grokEnv.fastVisionModel,
    system,
    content: [{ type: "input_text", text: user }],
    schema: briefJsonSchema(),
    name: "review_brief",
    parse: (raw) => BriefModelSchema.parse(raw),
    timeoutMs: 15_000,
    maxRetries: 0,
    mock: () => mock(),
  });

export async function reviewBrief(db: Db, base: CaseFile, submissionId: string, o: { mockError?: boolean; generate?: Generate; now?: Date } = {}): Promise<ReviewBrief> {
  const c = withStageSummary(base);
  const key = { kind: "review_brief", subjectId: submissionId, audience: c.audience, version: caseVersion(c) };
  const cached = await cacheGet<ReviewBrief>(db, key);
  if (cached && ReviewBriefSchema.safeParse(cached).success) return cached;
  const template = briefTemplate(c);
  let out: ReviewBrief | null = null;
  try {
    const raw = await (o.generate ?? defaultBriefGenerate)({
      op: "grokbot_review_brief",
      system: systemPrompt(c.audience, TASK),
      user: userContent(c),
      mock: () => {
        if (o.mockError) throw new Error("mock grokbot error");
        return template;
      },
    });
    const g = groundBrief(BriefModelSchema.parse(raw), c);
    if (g) out = toBrief(submissionId, g, c, isMockGrok() && !o.generate ? "template" : "grok", o.now);
  } catch (err) {
    console.warn("[grokbot] review_brief fell back to template:", err instanceof Error ? err.message : err);
  }
  out ??= toBrief(submissionId, template, c, "template", o.now);
  await cachePut(db, key, out, out.source, out.source === "grok" ? 3600 : 300).catch(() => undefined);
  return out;
}
