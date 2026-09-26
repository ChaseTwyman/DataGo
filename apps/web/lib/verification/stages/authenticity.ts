/**
 * Layer 4 — authenticity (PRD §9.2): screen recapture, printed photo, AI generation, editing, and
 * internal inconsistencies. Hard-fail thresholds live in decide(); this stage reports.
 */
import { AUTH_HARD_FAIL_CONFIDENCE, type ReasonCode, type Subcheck } from "@groundtruth/shared";
import type { Stage, StageOutcome } from "../types";

const CHECKS = [
  ["screen_recapture", "Not a screen", "SCREEN_RECAPTURE", true],
  ["printed_photo", "Not a print", "PRINTED_PHOTO", true],
  ["ai_generated", "Not AI-generated", "AI_GENERATED_SUSPECTED", true],
  ["edited_or_composited", "Not edited", "EDITED_SUSPECTED", false],
] as const;

export const authenticity: Stage = {
  id: "authenticity",
  async run(ctx): Promise<StageOutcome> {
    const m = await ctx.model();
    const min = ctx.input.protocol.acceptance.min_authenticity_score;
    const sub: Subcheck[] = [];
    const codes: ReasonCode[] = [];
    const evidence: string[] = [];
    let hard = false;

    for (const [key, label, code, canHardFail] of CHECKS) {
      const s = m.authenticity[key];
      if (!s.suspected) {
        sub.push({ id: key, label, status: "pass", detail: s.evidence });
        continue;
      }
      const isHard = canHardFail && s.confidence >= AUTH_HARD_FAIL_CONFIDENCE;
      hard ||= isHard;
      codes.push(code);
      sub.push({ id: key, label, status: isHard ? "fail" : "warn", detail: `${s.evidence} (confidence ${s.confidence.toFixed(2)})` });
      evidence.push(s.evidence);
    }
    const inconsistencies = m.scene.internal_inconsistencies;
    sub.push({
      id: "consistency",
      label: "Internally consistent",
      status: inconsistencies.length > 0 ? "warn" : "pass",
      ...(inconsistencies.length > 0 ? { detail: inconsistencies.join("; ") } : {}),
    });
    const scoreOk = m.authenticity_score >= min;
    sub.push({ id: "score", label: `Authenticity score ≥ ${min}`, status: scoreOk ? "pass" : "warn", detail: m.authenticity_score.toFixed(2) });
    if (evidence.length === 0) evidence.push("No signs of recapture, printing, generation, or editing");

    const warned = !scoreOk || codes.length > 0 || inconsistencies.length > 0;
    return {
      status: hard ? "fail" : warned ? "warn" : "pass",
      score: m.authenticity_score,
      reasonCodes: codes,
      evidence,
      subchecks: sub,
    };
  },
};
