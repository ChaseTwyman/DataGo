/**
 * Step 2: computed result → answer text, "How I answered" steps, and the citable methods note.
 *
 * The answer reuses Grokbot's compose pipeline: the case file holds ONLY facts derived from the
 * validated plan and the computed result rows (never the raw question, never unreturned data), the
 * model must cite fact ids, and groundDraft drops any line with a number that appears in no fact.
 * The deterministic template (made of fact texts) is the fallback and the MOCK_GROK fixture.
 */
import { OPEN_DATA_LICENSE, type CopilotPlan, type CopilotResult, type GrokbotMessage, type PublicRow } from "@groundtruth/shared";
import type { Db } from "../db";
import { composeMessage, type Generate } from "../grokbot/compose";
import type { CaseFile, Draft, DraftLine, Fact } from "../grokbot/types";
import { aggAlias, groupAlias } from "./grammar";

/** Result rows the answer step may see / cite. */
export const ANSWER_ROWS = 25;

const FN_WORD: Record<string, string> = { count: "count", min: "minimum", max: "maximum", mean: "mean", median: "median", p90: "90th percentile" };
const OP_WORD: Record<string, string> = { eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", in: "is one of", is_null: "is empty", not_null: "is present" };

export interface PlanContext {
  datasetName: string;
  datasetSlug: string;
  version: number;
  bountyTitle: string | null;
  now: Date;
}

const hoursText = (h: number) => (h % 24 === 0 && h >= 48 ? `last ${h / 24} days` : `last ${h} hour${h === 1 ? "" : "s"}`);
const minuteIso = (iso: string) => iso.replace(/:\d\d(\.\d+)?Z$/, "Z").replace(/:00Z$/, "Z");

/** The plan in plain words, one step per line (shown as "How I answered"). */
export function describePlan(p: CopilotPlan, c: PlanContext): string[] {
  const steps: string[] = [];
  steps.push(`Dataset: ${c.datasetSlug} v${c.version} (published, privacy-coarsened observations only)`);
  if (p.bounty_id) steps.push(`Request: ${c.bountyTitle ?? p.bounty_id}`);
  const t = p.time;
  if (t.since_hours !== null) steps.push(`Time: ${hoursText(t.since_hours)} (captured since ${minuteIso(new Date(c.now.getTime() - t.since_hours * 3_600_000).toISOString())})`);
  else if (t.from || t.to) steps.push(`Time: ${t.from ? `from ${minuteIso(t.from)}` : ""}${t.from && t.to ? " " : ""}${t.to ? `until ${minuteIso(t.to)}` : ""}`);
  else steps.push("Time: all time");
  if (p.near) steps.push(`Place: within ${Math.round(p.near.radius_m)} m of ${p.near.label} (${p.near.lat.toFixed(4)}, ${p.near.lng.toFixed(4)}), measured to cell centres`);
  if (p.quality_tier) steps.push(`Quality tier: ${p.quality_tier}`);
  for (const f of p.filters) {
    const v = f.op === "in" ? f.values.join(", ") : f.op === "is_null" || f.op === "not_null" ? "" : ` ${f.value}`;
    steps.push(`Filter: ${f.field} ${OP_WORD[f.op]}${f.op === "in" ? ` ${v}` : v}`);
  }
  if (p.coverage !== "none") {
    steps.push(`Coverage: observations per cell of the request vs its per-cell target (${p.coverage.replace("_", " ")})`);
  } else {
    const g = groupAlias(p);
    if (g) steps.push(`Group by: ${g === "h3_cell" ? "H3 cell" : g}`);
    if (p.aggregates.length) steps.push(`Compute: ${p.aggregates.map((a) => (a.field ? `${FN_WORD[a.fn]} of ${a.field}` : FN_WORD[a.fn])).join(", ")}`);
  }
  if (p.sort) steps.push(`Sort: ${p.sort.by} ${p.sort.dir === "desc" ? "descending" : "ascending"}; at most ${p.limit} rows`);
  return steps;
}

export function valueText(v: PublicRow[string]): string {
  if (v === null || v === undefined) return "empty";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v);
}

function rowText(row: PublicRow, result: CopilotResult, mode: "rows" | "agg"): string {
  const cols = result.columns.filter((c) => mode === "agg" || !["lat", "lng", "observation_id"].includes(c.name));
  return cols.map((c) => `${c.label} = ${valueText(row[c.name] ?? null)}`).join("; ");
}

export interface CoverageInfo {
  cells: number;
  target: number;
}

export function answerCaseFile(
  p: CopilotPlan,
  result: CopilotResult,
  steps: string[],
  audience: "researcher" | "public",
  subjectId: string,
  coverage?: CoverageInfo,
): CaseFile {
  const obs = (ref: string) => ({ kind: "observation" as const, ref, detail: null });
  const facts: Fact[] = [];
  // The absolute "since" time is left out so the answer cache survives the clock ticking.
  const planText = steps.map((s) => s.replace(/ \(captured since [^)]*\)/, "")).join("; ");
  facts.push({ id: "plan", citation: obs("query plan"), text: `The question was answered as: ${planText}.` });
  facts.push({
    id: "scope",
    citation: obs("observations matched"),
    text: `${result.observations_matched} published observations matched the filters, out of ${result.observations_in_scope} in scope.`,
  });
  const shown = Math.min(result.rows.length, ANSWER_ROWS);
  facts.push({
    id: "rows",
    citation: obs("result size"),
    text: `The result has ${result.total_rows} row${result.total_rows === 1 ? "" : "s"}${shown < result.total_rows ? `; the first ${shown} are listed` : ""}.`,
  });
  if (coverage && p.coverage !== "none") {
    const what = p.coverage === "under_target" ? "are below" : p.coverage === "met_target" ? "have reached" : "are listed against";
    facts.push({
      id: "coverage",
      citation: obs("coverage"),
      text: `${result.total_rows} of the ${coverage.cells} cells in this request ${what} the target of ${coverage.target} observations per cell.`,
    });
  }
  const mode = groupAlias(p) !== null || p.aggregates.length > 0 ? "agg" : "rows";
  result.rows.slice(0, ANSWER_ROWS).forEach((r, i) => {
    facts.push({ id: `row.${i + 1}`, citation: obs(`result row ${i + 1}`), text: `Result row ${i + 1}: ${rowText(r, result, mode)}.` });
  });
  return { kind: "copilot_answer", subjectId, audience, facts, untrusted: [], injectionFlags: [] };
}

const line = (text: string, cites: string[]): DraftLine => ({ text, cites });
const fact = (c: CaseFile, id: string) => c.facts.find((f) => f.id === id)?.text ?? "";

/** Deterministic answer built only from fact texts (always passes grounding). */
export function answerTemplate(c: CaseFile, p: CopilotPlan, result: CopilotResult): Draft {
  const has = (id: string) => c.facts.some((f) => f.id === id);
  if (result.rows.length === 0) {
    return {
      headline: line("No published observations matched this question.", ["scope"]),
      paragraphs: [line(fact(c, "scope"), ["scope"]), line(fact(c, "plan"), ["plan"])],
      next_steps: [line("Widen the time window or the distance, or remove a filter.", ["plan"])],
    };
  }
  let headline: DraftLine;
  if (has("coverage")) headline = line(fact(c, "coverage"), ["coverage"]);
  else if (p.aggregates.length && groupAlias(p) === null) {
    const r = result.rows[0]!;
    headline = line(p.aggregates.map((a) => `${result.columns.find((x) => x.name === aggAlias(a.fn, a.field))?.label ?? a.fn}: ${valueText(r[aggAlias(a.fn, a.field)] ?? null)}`).join(" · "), ["row.1"]);
  } else headline = line(`Top result: ${fact(c, "row.1").replace(/^Result row 1: /, "").replace(/\.$/, "")}`, ["row.1"]);
  const rows = c.facts.filter((f) => f.id.startsWith("row.")).slice(0, 3).map((f) => line(f.text, [f.id]));
  return {
    headline,
    paragraphs: [line(fact(c, "scope"), ["scope"]), line(fact(c, "rows"), ["rows"]), ...rows].slice(0, 4),
    next_steps: [],
  };
}

const TASK =
  "Answer the question described in fact `plan` using ONLY the result facts (scope, rows, coverage, row.N). Lead with the key figure(s) and the row they come from. " +
  "Say how many observations the answer rests on (fact `scope`). If few observations matched, say the answer rests on few observations. " +
  "Never generalize beyond the rows, never infer causes, never mention people. Cite the row facts you use.";

export async function composeAnswer(
  db: Db,
  c: CaseFile,
  p: CopilotPlan,
  result: CopilotResult,
  o: { generate?: Generate; mockError?: boolean },
): Promise<GrokbotMessage> {
  return composeMessage(db, {
    op: "copilot_answer",
    caseFile: c,
    task: TASK,
    template: answerTemplate(c, p, result),
    ttlSeconds: 3600,
    ...(o.mockError ? { mockError: true } : {}),
    ...(o.generate ? { generate: o.generate } : {}),
  });
}

/** Citable methods paragraph. */
export function methodsNote(c: PlanContext, result: CopilotResult, steps: string[], origin: string): string {
  const when = `${c.now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return [
    `Data: GroundTruth ${c.datasetSlug} (${c.datasetName}, version ${c.version}), ${OPEN_DATA_LICENSE.short_name}, attribution "${OPEN_DATA_LICENSE.attribution}".`,
    `${result.observations_matched} accepted, published observations matched (of ${result.observations_in_scope} in scope); only human-verified rows and rows the automated pipeline accepted at confidence ≥ 0.75 are published.`,
    `Query: ${steps.slice(1).join("; ")}.`,
    "Locations are H3 resolution-9 cell centres (distances are measured to cell centres, about ±175 m) and capture times are floored to 5-minute UTC windows; aggregates are rounded to 2 decimals.",
    `Computed by GroundTruth Ask-the-data from the query plan shown; retrieved ${when} from ${origin}/data#${c.datasetSlug}.`,
  ].join(" ");
}
