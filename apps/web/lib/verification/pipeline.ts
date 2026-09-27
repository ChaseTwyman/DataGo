/**
 * The verification pipeline (PRD §9.2). Each stage writes its StageResult into the sink as it starts
 * and finishes (the phone animates from these). A stage that throws becomes `error` → decide() routes
 * to needs_review, never auto-accept. A failed session-integrity stage short-circuits: the remaining
 * stages are skipped and nothing is sent to the model.
 *
 * Latency: the reasoning-model call is the long pole, so it starts as soon as session integrity
 * passes, concurrently with the fast relevance screen. Relevance still gates: an off-topic verdict
 * aborts the in-flight call (its result could never be used) and marks the model stages skipped;
 * the non-model stages still run. After relevance, the remaining stages run concurrently (they share
 * the one memoised model call; context/duplicates/corroboration do their own I/O meanwhile).
 */
import {
  decide,
  optionalElementIds,
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
import { relevance } from "./stages/relevance";
import { sessionIntegrity } from "./stages/sessionIntegrity";
import type { PipelineDeps, PipelineInput, Stage, StageContext, StageSink } from "./types";

export const PIPELINE: Stage[] = [sessionIntegrity, relevance, challenge, protocolStage, authenticity, context, duplicates, corroboration];

const OFF_TOPIC_SKIP = "Skipped: the relevance check found the capture off-topic";

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
  const modelCall = modelAccessor(input, deps);
  const ctx: StageContext = {
    input,
    deps,
    model: modelCall,
    hashes: () => (hashesP ??= Promise.all(input.frames.filter((f) => f.bytes).map((f) => dHash(f.bytes!)))),
  };

  // Concurrent stages write the shared array; serialise sink writes so a slow write of an older
  // snapshot can never land after a newer one.
  let writes: Promise<void> = Promise.resolve();
  const write = (): Promise<void> => {
    const snapshot = structuredClone(checks);
    writes = writes.then(() => sink.write(snapshot));
    return writes;
  };

  const runStage = async (i: number): Promise<void> => {
    const stage = PIPELINE[i]!;
    const label = stageLabel(stage.id);
    checks[i] = { ...checks[i]!, status: "running" };
    await write();
    const t0 = deps.now().getTime();
    try {
      const out = await stage.run(ctx);
      checks[i] = { stage: stage.id, label, ...out, ms: Math.max(0, deps.now().getTime() - t0) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks[i] = { stage: stage.id, label, status: "error", score: null, reasonCodes: [], evidence: [`Stage error: ${msg}`], ms: Math.max(0, deps.now().getTime() - t0) };
    }
    await write();
  };
  const indexOf = (id: string) => PIPELINE.findIndex((s) => s.id === id);

  // 1. Session integrity: a failure halts everything, before any model sees a frame.
  const integrity = indexOf("session_integrity");
  await runStage(integrity);
  const halted = checks[integrity]!.status === "fail";

  if (halted) {
    for (const [i, stage] of PIPELINE.entries()) {
      if (i === integrity) continue;
      checks[i] = { stage: stage.id, label: stageLabel(stage.id), status: "skipped", score: null, reasonCodes: [], evidence: ["Skipped after a failed integrity check"], ms: 0 };
    }
  } else {
    // 2. Start the long pole now; relevance runs meanwhile.
    void modelCall();
    void ctx.hashes().catch(() => undefined);
    const rel = indexOf("relevance");
    await runStage(rel);
    const offTopic = checks[rel]!.reasonCodes.includes("OFF_TOPIC");
    if (offTopic) {
      // Its result could never be used: cancel the in-flight call. Later stages that consult the
      // model (daylight, corroboration) degrade to "unavailable".
      modelCall.abort(OFF_TOPIC_SKIP);
      const skipped = Promise.reject(new Error(OFF_TOPIC_SKIP));
      skipped.catch(() => undefined);
      ctx.model = () => skipped;
    }
    // 3. Everything else, concurrently.
    const rest: Promise<void>[] = [];
    for (const [i, stage] of PIPELINE.entries()) {
      if (i === integrity || i === rel) continue;
      if (offTopic && stage.usesModel) {
        checks[i] = { stage: stage.id, label: stageLabel(stage.id), status: "skipped", score: null, reasonCodes: [], evidence: [OFF_TOPIC_SKIP], ms: 0 };
        rest.push(write());
        continue;
      }
      rest.push(runStage(i));
    }
    await Promise.all(rest);
  }
  await writes;

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
    optionalElements: optionalElementIds(input.protocol),
    ...(model ? { authenticity: model.authenticity, elements: model.elements } : {}),
    ...(input.protocol.acceptance.element_absent_reject_confidence !== undefined
      ? { elementAbsentConfidence: input.protocol.acceptance.element_absent_reject_confidence }
      : {}),
  });
  return { checks, decision, model, phashes };
}
