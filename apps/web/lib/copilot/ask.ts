/**
 * Ask the data: question → validated plan → parameterized SQL over coarsened public rows →
 * grounded answer + methods note. See contracts/copilot.ts for the guarantees.
 *
 * Caching: the PLAN is cached by (dataset slug, version, scope, audience, normalized question) — it
 * doesn't depend on the data, relative windows are re-anchored at execution, and it is revalidated
 * on every use. The result is always recomputed; the answer text is cached by the result (compose's
 * case-file version), so a new observation yields a new answer.
 */
import { createHash } from "node:crypto";
import {
  COPILOT_REFUSAL,
  CopilotAnswerSchema,
  type CopilotAnswer,
  type CopilotAskRequest,
  type CopilotPlan,
} from "@groundtruth/shared";
import { forbidden, grokUnavailable } from "../api/http";
import type { Db } from "../db";
import { isMockGrok } from "../grok/config";
import { cacheGet, cachePut } from "../grokbot/cache";
import type { Generate } from "../grokbot/compose";
import { injectionReasons } from "../grokbot/injection";
import { loadPublishedProtocol, publicRows, publishedSlugs } from "../openData";
import { answerCaseFile, composeAnswer, describePlan, methodsNote, type PlanContext } from "./answer";
import { buildCatalogue, validatePlan } from "./grammar";
import { mockPlan, modelPlanner, type PlanFn, type PlannerBounty, type PlannerInput } from "./planner";
import { compilePlan, recordsetRows, runPlan } from "./sql";

export interface DatasetBountyInfo extends PlannerBounty {
  cells: string[];
  target_per_cell: number;
  created_by: string | null;
}

/** Non-draft bounties of a dataset (the same set the open-data API lists). */
export async function copilotBounties(db: Db, slug: string): Promise<DatasetBountyInfo[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select b.id, b.title, b.center_lat, b.center_lng, b.radius_m, b.cells, b.target_per_cell, b.created_by
       from public.bounties b join public.protocols p on p.id = b.protocol_id
      where p.slug = $1 and b.status <> 'draft'
      order by b.created_at`,
    [slug],
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    center_lat: Number(r.center_lat),
    center_lng: Number(r.center_lng),
    radius_m: Number(r.radius_m),
    cells: (r.cells as string[] | null) ?? [],
    target_per_cell: Number(r.target_per_cell),
    created_by: (r.created_by as string | null) ?? null,
  }));
}

export interface AskOptions {
  audience: "researcher" | "public";
  /** Whether the caller owns a bounty (scoping + coverage vs target). Public: always false. */
  owns: (b: DatasetBountyInfo) => boolean;
  origin: string;
  planner?: PlanFn;
  generate?: Generate;
  mockError?: boolean;
  now?: Date;
}

export const normalizeQuestion = (q: string): string =>
  q
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?.!\s]+$/, "")
    .trim();

function refusal(question: string, reason: string, now: Date, dataset: CopilotAnswer["dataset"] = null, plan: CopilotPlan | null = null, planner: CopilotAnswer["planner"] = "none"): CopilotAnswer {
  return CopilotAnswerSchema.parse({
    status: "refused",
    question,
    refusal: reason,
    dataset,
    plan,
    plan_steps: [],
    result: null,
    answer: null,
    methods: null,
    chart: "table",
    planner,
    generated_at: now.toISOString(),
  });
}

export async function askData(db: Db, req: CopilotAskRequest, o: AskOptions): Promise<CopilotAnswer> {
  const now = o.now ?? new Date();
  const question = req.question.trim();

  // Untrusted text: instruction-like questions are refused before any model call. (The plan grammar
  // makes a successful injection harmless anyway; this just saves the call and says why.)
  if (injectionReasons(question).length) return refusal(question, `${COPILOT_REFUSAL} Your question looked like instructions to the assistant.`, now);

  const slugs = await publishedSlugs(db);
  const slug = req.dataset ?? (slugs.includes("street-flood-depth") ? "street-flood-depth" : slugs[0]);
  const protocol = slug && slugs.includes(slug) ? await loadPublishedProtocol(db, slug) : null;
  if (!protocol) return refusal(question, "That dataset is not published.", now);
  const dataset = { slug: protocol.slug, name: protocol.name, version: protocol.version };
  const catalogue = buildCatalogue(protocol.slug, protocol.definition);
  const bounties = await copilotBounties(db, protocol.slug);

  const scoped = req.bounty_id ?? null;
  if (scoped && !bounties.some((b) => b.id === scoped)) return refusal(question, "That request is not part of this dataset.", now, dataset);
  const owned = o.audience === "researcher" ? bounties.filter((b) => o.owns(b)).map((b) => b.id) : [];
  if (scoped && !owned.includes(scoped)) throw forbidden("You can scope questions to your own requests only.");
  const allowCoverage = o.audience === "researcher" && owned.length > 0 && (!scoped || owned.includes(scoped));

  // ---- plan (cached)
  const input: PlannerInput = {
    question,
    catalogue,
    datasetName: protocol.name,
    bounties,
    scopedBountyId: scoped,
    allowCoverage,
    now,
  };
  const key = {
    kind: "copilot_plan",
    subjectId: `${protocol.slug}:v${protocol.version}:${scoped ?? "all"}:${allowCoverage ? "cov" : "nocov"}`,
    audience: o.audience,
    version: createHash("sha256").update(normalizeQuestion(question)).digest("hex").slice(0, 32),
  } as const;
  let raw: unknown = await cacheGet<unknown>(db, key).catch(() => null);
  let planner: CopilotAnswer["planner"] = "cache";
  if (raw === null) {
    try {
      raw = await (o.planner ?? modelPlanner)(input);
      planner = isMockGrok() && !o.planner ? "mock" : "grok";
    } catch (err) {
      // Grok down: the keyword planner still answers the common questions; otherwise a friendly 502.
      const fallback = mockPlan(input);
      if (!fallback.answerable) throw grokUnavailable(err, "copilot plan");
      raw = fallback;
      planner = "mock";
    }
    // Relative times make a plan reusable; absolute "now"-dependent bits are re-anchored at execution.
    await cachePut(db, key, raw, planner === "grok" ? "grok" : "template", 24 * 3600).catch(() => undefined);
  }

  const v = validatePlan(raw, { catalogue, allowedBountyIds: bounties.map((b) => b.id), allowCoverage, now });
  if (!v.ok) return refusal(question, v.reason, now, dataset, null, planner);
  const plan = v.plan;
  // A signed-in caller's explicit scope always wins over whatever the model put there.
  if (scoped) plan.bounty_id = scoped;
  if (plan.coverage !== "none" && !(plan.bounty_id && owned.includes(plan.bounty_id))) {
    return refusal(question, "Coverage against targets is available for your own requests only.", now, dataset, null, planner);
  }
  const bounty = plan.bounty_id ? bounties.find((b) => b.id === plan.bounty_id) ?? null : null;

  // ---- execute over the coarsened public rows (the exact rows /api/public/datasets serves)
  const rows = await publicRows(db, protocol, plan.bounty_id ? { bountyId: plan.bounty_id } : {});
  const payload = JSON.stringify(recordsetRows(rows, catalogue));
  const coverage = plan.coverage !== "none" && bounty ? { cells: bounty.cells, target: bounty.target_per_cell } : undefined;
  const compiled = compilePlan(plan, catalogue, payload, now, coverage);
  const result = await runPlan(db, compiled, plan.limit, rows.length);

  // ---- answer
  const ctx: PlanContext = { datasetName: protocol.name, datasetSlug: protocol.slug, version: protocol.version, bountyTitle: bounty?.title ?? null, now };
  const steps = describePlan(plan, ctx);
  const caseFile = answerCaseFile(plan, result, steps, o.audience, key.subjectId, coverage ? { cells: coverage.cells.length, target: coverage.target } : undefined);
  const answer = await composeAnswer(db, caseFile, plan, result, {
    ...(o.generate ? { generate: o.generate } : {}),
    ...(o.mockError ? { mockError: true } : {}),
  });

  return CopilotAnswerSchema.parse({
    status: "answered",
    question,
    refusal: null,
    dataset,
    plan,
    plan_steps: steps,
    result,
    answer,
    methods: methodsNote(ctx, result, steps, o.origin),
    chart: plan.chart,
    planner,
    generated_at: now.toISOString(),
  });
}
