/**
 * Layer 3 — protocol compliance + extraction (PRD §9.2): required elements, quality, protocol score,
 * and extraction sanity (the protocol's own plausibility rules over the extracted values: a depth
 * that no reference object could show, or no reading at all, is not trusted just because the model
 * produced a number).
 */
import { checkExtraction, missingElement, type ReasonCode, type Subcheck } from "@groundtruth/shared";
import type { Stage, StageOutcome } from "../types";

export const ELEMENT_MIN_CONFIDENCE = 0.5;

export const protocolStage: Stage = {
  id: "protocol",
  usesModel: true,
  async run(ctx): Promise<StageOutcome> {
    const { protocol } = ctx.input;
    const m = await ctx.model();
    const sub: Subcheck[] = [];
    const codes: ReasonCode[] = [];

    for (const el of protocol.capture.required_elements) {
      const seen = m.elements.find((e) => e.id === el.id);
      const ok = !!seen && seen.present && seen.confidence >= ELEMENT_MIN_CONFIDENCE;
      sub.push({ id: `element:${el.id}`, label: el.label, status: ok ? "pass" : "fail", detail: seen?.evidence ?? "Not reported by the model" });
      if (!ok) codes.push(missingElement(el.id));
    }
    const q = m.quality;
    sub.push({ id: "blur", label: "Sharp", status: q.blur_ok ? "pass" : "fail" });
    if (!q.blur_ok) codes.push("BLURRY");
    sub.push({ id: "lighting", label: "Well lit", status: q.lighting_ok ? "pass" : "warn" });
    if (!q.lighting_ok) codes.push("TOO_DARK");
    sub.push({ id: "framing", label: "Framed", status: q.framing_ok ? "pass" : "warn" });
    if (!q.framing_ok) codes.push("BAD_FRAMING");

    const min = protocol.acceptance.min_protocol_score;
    const scoreOk = m.protocol_score >= min;
    sub.push({ id: "score", label: `Protocol score ≥ ${min}`, status: scoreOk ? "pass" : "fail", detail: m.protocol_score.toFixed(2) });

    const sanity = checkExtraction(protocol, m.extraction);
    for (const f of sanity.findings) {
      if (!f.applied) continue;
      sub.push({
        id: `extraction:${f.rule.kind}:${f.rule.field}`,
        label: f.rule.kind === "required_number" ? `${f.rule.field} measured` : f.rule.kind === "max_relative" ? `${f.rule.field} plausible` : `${f.rule.field} confident`,
        status: f.ok ? "pass" : f.code === "EXTRACTION_MISSING" ? "fail" : "warn",
        detail: f.detail,
      });
    }
    codes.push(...sanity.codes);

    const failed = codes.some((c) => c.startsWith("MISSING_ELEMENT:") || c === "BLURRY" || c === "EXTRACTION_MISSING") || !scoreOk;
    const warned = codes.length > 0;
    const extracted = Object.entries(m.extraction)
      .filter(([, v]) => v !== null && v !== "")
      .slice(0, 6)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(", ");
    return {
      status: failed ? "fail" : warned ? "warn" : "pass",
      score: m.protocol_score,
      reasonCodes: codes,
      evidence: [m.summary, ...(extracted ? [`Extracted: ${extracted}`] : [])],
      subchecks: sub,
    };
  },
};
