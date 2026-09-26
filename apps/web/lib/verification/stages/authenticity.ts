/**
 * Layer 4 — authenticity (PRD §9.2): screen recapture, printed photo, AI generation, editing, and
 * internal inconsistencies. Hard-fail thresholds live in decide(); this stage reports.
 */
import { AUTH_HARD_FAIL_CONFIDENCE, type ReasonCode, type Subcheck } from "@groundtruth/shared";
import { readProvenance } from "../../image/c2pa";
import type { Stage, StageOutcome } from "../types";

const CHECKS = [
  ["screen_recapture", "Not a screen", "SCREEN_RECAPTURE", true],
  ["printed_photo", "Not a print", "PRINTED_PHOTO", true],
  ["ai_generated", "Not AI-generated", "AI_GENERATED_SUSPECTED", true],
  ["edited_or_composited", "Not edited", "EDITED_SUSPECTED", false],
] as const;

/**
 * Provenance labels in the frame bytes (C2PA / IPTC XMP). Grok Imagine signs its output with a C2PA
 * manifest declaring trainedAlgorithmicMedia; the vision model alone did not reliably flag such
 * fakes. Runs before (and independently of) the model, so a labeled fake is rejected even when the
 * model is fooled or errors. Absence of a label proves nothing and is never used as positive evidence.
 */
function provenanceCheck(frames: { bytes: Buffer | null }[]): { sub: Subcheck; hit: string | null } {
  for (const [i, f] of frames.entries()) {
    if (!f.bytes) continue;
    const p = readProvenance(f.bytes);
    if (p.aiGenerated) {
      const who = p.generator ? `${p.generator}, ` : "";
      const detail = `Frame ${i + 1}: ${p.source === "c2pa" ? "C2PA manifest" : "IPTC metadata"} declares AI-generated media (${who}${p.digitalSourceType})`;
      return { sub: { id: "c2pa", label: "No AI provenance label", status: "fail", detail }, hit: detail };
    }
  }
  return { sub: { id: "c2pa", label: "No AI provenance label", status: "pass" }, hit: null };
}

export const authenticity: Stage = {
  id: "authenticity",
  usesModel: true,
  async run(ctx): Promise<StageOutcome> {
    const prov = provenanceCheck(ctx.input.frames);
    let m;
    try {
      m = await ctx.model();
    } catch (err) {
      // The label alone is conclusive; without it, surface the model error as usual.
      if (!prov.hit) throw err;
      return { status: "fail", score: 0, reasonCodes: ["C2PA_AI_GENERATED"], evidence: [prov.hit], subchecks: [prov.sub] };
    }
    const min = ctx.input.protocol.acceptance.min_authenticity_score;
    const sub: Subcheck[] = [prov.sub];
    const codes: ReasonCode[] = prov.hit ? ["C2PA_AI_GENERATED"] : [];
    const evidence: string[] = prov.hit ? [prov.hit] : [];
    let hard = prov.hit !== null;

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
      score: prov.hit ? 0 : m.authenticity_score,
      reasonCodes: codes,
      evidence,
      subchecks: sub,
    };
  },
};
