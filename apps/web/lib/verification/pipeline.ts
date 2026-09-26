/**
 * The verification pipeline (PRD §9.2). Stages run in order, each writing its StageResult into the
 * sink as it starts and finishes (the phone animates from these). A stage that throws becomes
 * `error` → decide() routes to needs_review, never auto-accept. A failed session-integrity stage
 * short-circuits: the remaining stages are skipped and nothing is sent to the model.
 */
import {
  decide,
  pendingChecks,
  stageLabel,
  type Decision,
  type StageResult,
  type VerificationOutput,
} from "@groundtruth/shared";
import { dHash } from "../image/dhash";
import { authenticity } from "./stages/authenticity";
import { challenge } from "./stages/challenge";
import { context } from "./stages/context";
import { corroboration } from "./stages/corroboration";
import { duplicates } from "./stages/duplicates";
import { modelAccessor } from "./stages/modelVerification";
import { protocolStage } from "./stages/protocol";
import { sessionIntegrity } from "./stages/sessionIntegrity";
import type { PipelineDeps, PipelineInput, Stage, StageContext, StageSink } from "./types";

export const PIPELINE: Stage[] = [sessionIntegrity, challenge, protocolStage, authenticity, context, duplicates, corroboration];

export interface PipelineResult {
  checks: StageResult[];
  decision: Decision;
  model: VerificationOutput | null;
  phashes: string[];
}

export const memorySink = (): StageSink & { history: StageResult[][] } => {
  const history: StageResult[][] = [];
  return {
    history,
    async write(checks) {
      history.push(structuredClone(checks));
    },
  };
};

export async function runPipeline(input: PipelineInput, deps: PipelineDeps, sink: StageSink): Promise<PipelineResult> {
  const checks = pendingChecks();
  await sink.write(checks);

  let hashesP: Promise<string[]> | null = null;
  const ctx: StageContext = {
    input,
    deps,
    model: modelAccessor(input, deps),
    hashes: () => (hashesP ??= Promise.all(input.frames.filter((f) => f.bytes).map((f) => dHash(f.bytes!)))),
  };

  let halted = false;
  for (const [i, stage] of PIPELINE.entries()) {
    const label = stageLabel(stage.id);
    if (halted) {
      checks[i] = { stage: stage.id, label, status: "skipped", score: null, reasonCodes: [], evidence: ["Skipped after a failed integrity check"], ms: 0 };
      continue;
    }
    checks[i] = { ...checks[i]!, status: "running" };
    await sink.write(checks);
    const t0 = deps.now().getTime();
    try {
      const out = await stage.run(ctx);
      checks[i] = { stage: stage.id, label, ...out, ms: Math.max(0, deps.now().getTime() - t0) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks[i] = { stage: stage.id, label, status: "error", score: null, reasonCodes: [], evidence: [`Stage error: ${msg}`], ms: Math.max(0, deps.now().getTime() - t0) };
    }
    await sink.write(checks);
    if (stage.id === "session_integrity" && checks[i]!.status === "fail") halted = true;
  }

  let model: VerificationOutput | null = null;
  if (!halted) {
    try {
      model = await ctx.model();
    } catch {
      model = null;
    }
  }
  let phashes: string[] = [];
  try {
    phashes = halted ? [] : await ctx.hashes();
  } catch {
    phashes = [];
  }

  const score = (id: string, fallback: number) => checks.find((c) => c.stage === id)?.score ?? fallback;
  const decision = decide({
    stages: checks,
    protocolScore: model?.protocol_score ?? 0,
    authenticityScore: model?.authenticity_score ?? 0,
    contextScore: score("context", 0.5),
    corroborationScore: score("corroboration", 0.5),
    trustScore: input.trustScore,
    minProtocolScore: input.protocol.acceptance.min_protocol_score,
    minAuthenticityScore: input.protocol.acceptance.min_authenticity_score,
    ...(model ? { authenticity: model.authenticity } : {}),
  });
  return { checks, decision, model, phashes };
}
