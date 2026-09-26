/**
 * Phase 2: Studio self-check. Before a researcher publishes a protocol, run its example image (an
 * AI-generated "ideal shot", generated if missing) through the SAME live models contributors will
 * face: the fast frame check three times (it is sampled, so one run proves little) and the relevance
 * screen once. Each required element gets ok / weak / undetectable with a concrete suggestion.
 *
 * Advisory only: the result is stored on the protocol for the dashboard to show and to warn at
 * publish time. Publishing never reads it; the researcher decides.
 */
import {
  isOffTopic,
  StudioSelfCheckSchema,
  type FrameCheckResult,
  type MockVariant,
  type Protocol,
  type RelevanceResult,
  type StudioSelfCheck,
} from "@groundtruth/shared";
import type { Db } from "../db";
import type { ProtocolRow } from "../db/repos/protocols";
import { generateExampleImage } from "../examples";
import { GrokError } from "../grok/config";
import { frameCheck, relevanceCheck } from "../grok/vision";
import { toModelFrame } from "../image/modelFrame";
import type { ObjectStorage } from "../storage";

export const SELF_CHECK_RUNS = 3;
/** Same visibility threshold the live gate uses (isFrameAllGreen). */
const VISIBLE_AT = 0.5;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Pure: frame-check runs + relevance → per-element verdicts and the overall call. */
export function computeSelfCheck(
  protocolId: string,
  protocol: Protocol,
  runs: FrameCheckResult[],
  relevance: RelevanceResult | null,
  opts: { failedRuns?: number; exampleImageUrl?: string | null; now?: Date } = {},
): StudioSelfCheck {
  const n = runs.length;
  const suggestions: string[] = [];
  const elements = protocol.capture.required_elements.map((e) => {
    const seen = runs.map((r) => r.elements.find((x) => x.id === e.id)).filter((x) => x && x.visible && x.confidence >= VISIBLE_AT);
    const rel = relevance?.elements.find((x) => x.id === e.id);
    const relSees = rel ? rel.visible && rel.confidence >= VISIBLE_AT : null;
    const confidence = seen.length ? Math.round((seen.reduce((a, x) => a + x!.confidence, 0) / seen.length) * 100) / 100 : null;
    let verdict: "ok" | "weak" | "undetectable";
    if (n > 0 && seen.length === n && relSees !== false && (confidence ?? 0) >= 0.7) verdict = "ok";
    else if (seen.length === 0 && relSees !== true) verdict = "undetectable";
    else verdict = "weak";
    const suggestion =
      verdict === "ok"
        ? null
        : verdict === "undetectable"
          ? clip(`The live check could not see "${e.label}" in the example. Rename it to something plainly visible, split it into simpler elements, or describe where it sits in the frame.`, 240)
          : clip(`"${e.label}" was detected in ${seen.length} of ${n} checks${relSees === false ? " and missed by the relevance screen" : ""}. Make the description more concrete (size, colour, position) or add a reference object next to it.`, 240);
    if (suggestion) suggestions.push(suggestion);
    return { id: e.id, label: e.label, verdict, confidence, suggestion };
  });
  const relevanceOk = relevance ? relevance.subject_match.value && !isOffTopic(relevance) : false;
  if (!relevance) suggestions.push("The relevance screen could not run; run the self-check again before publishing.");
  else if (!relevanceOk) suggestions.push("The relevance screen did not recognise the example as this protocol's subject. Describe the scene more concretely in why-it-matters and the element descriptions.");
  if (runs.some((r) => r.suspected_screen_or_print.value)) {
    suggestions.push("The live check thought the example looked like a screen or a print, which would lock the shutter. Regenerate the example image.");
  }
  if (opts.failedRuns) suggestions.push(`${opts.failedRuns} of ${n + opts.failedRuns} frame checks failed to run; the result is partial.`);
  const overall = relevanceOk && n > 0 && elements.every((e) => e.verdict === "ok") ? "ready" : "revise";
  return StudioSelfCheckSchema.parse({
    protocol_id: protocolId,
    overall,
    elements,
    relevance_ok: relevanceOk,
    example_image_url: opts.exampleImageUrl ?? null,
    suggestions: suggestions.slice(0, 8),
    checked_at: (opts.now ?? new Date()).toISOString(),
  });
}

export async function runSelfCheck(db: Db, storage: ObjectStorage, p: ProtocolRow, o: { variant?: MockVariant } = {}): Promise<StudioSelfCheck> {
  const { path } = await generateExampleImage(db, storage, p);
  const frame = (await toModelFrame(await storage.get(path), 640)).toString("base64");
  const variant = o.variant ? { variant: o.variant } : {};
  const [settled, relevance] = await Promise.all([
    Promise.allSettled(Array.from({ length: SELF_CHECK_RUNS }, () => frameCheck({ protocol: p.definition, imageBase64: frame, timeoutMs: 15_000, ...variant }))),
    relevanceCheck({ protocol: p.definition, imageBase64: frame, ...variant }).catch((err: unknown) => {
      console.warn("[grokbot] self-check relevance failed:", err instanceof Error ? err.message : err);
      return null;
    }),
  ]);
  const runs = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (runs.length === 0) {
    const first = settled.find((s) => s.status === "rejected");
    throw new GrokError("self-check: every frame check failed", "self_check", first && first.status === "rejected" ? first.reason : undefined);
  }
  const result = computeSelfCheck(p.id, p.definition, runs, relevance, { failedRuns: SELF_CHECK_RUNS - runs.length });
  await db.query("update public.protocols set self_check = $2::jsonb where id = $1", [p.id, JSON.stringify(result)]);
  return result;
}

export async function storedSelfCheck(db: Db, protocolId: string): Promise<StudioSelfCheck | null> {
  const rows = await db.query<{ self_check: unknown }>("select self_check from public.protocols where id = $1", [protocolId]);
  const raw = rows[0]?.self_check;
  if (raw === null || raw === undefined) return null;
  const parsed = StudioSelfCheckSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
  return parsed.success ? parsed.data : null;
}
