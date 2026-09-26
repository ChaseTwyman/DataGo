/**
 * Extraction sanity: pure, per-protocol plausibility rules over the model's structured extraction
 * (rules live in protocol.acceptance.extraction_rules, see ExtractionRuleSchema). The model can
 * return a confident-looking number for a scene that cannot support it (e.g. a depth for a photo
 * of a drink bottle); these rules catch values no honest reading could produce.
 */
import type { ExtractionRule, Protocol } from "./protocols/protocol";
import type { ReasonCode } from "./reasonCodes";

export interface ExtractionFinding {
  rule: ExtractionRule;
  ok: boolean;
  /** null when the rule passed or did not apply. */
  code: ReasonCode | null;
  /** false when the rule could not be evaluated (e.g. reference value absent). */
  applied: boolean;
  detail: string;
}

export interface ExtractionSanity {
  codes: ReasonCode[];
  findings: ExtractionFinding[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function evaluate(rule: ExtractionRule, ex: Record<string, unknown>): ExtractionFinding {
  const v = num(ex[rule.field]);
  switch (rule.kind) {
    case "required_number": {
      const ok = v !== null && (rule.min === undefined || v >= rule.min);
      return {
        rule,
        ok,
        applied: true,
        code: ok ? null : "EXTRACTION_MISSING",
        detail: ok
          ? `${rule.field}=${v}`
          : v === null
            ? `${rule.field} missing (${JSON.stringify(ex[rule.field] ?? null)})`
            : `${rule.field}=${v} is below ${rule.min}`,
      };
    }
    case "max_relative": {
      const ref = num(ex[rule.reference_field]);
      if (v === null || ref === null || ref <= 0) {
        return { rule, ok: true, applied: false, code: null, detail: `${rule.field} vs ${rule.reference_field}: not evaluated (value missing)` };
      }
      const max = Math.round(ref * rule.factor * 10) / 10;
      const ok = v <= max;
      return {
        rule,
        ok,
        applied: true,
        code: ok ? null : "EXTRACTION_IMPLAUSIBLE",
        detail: `${rule.field}=${v} ${ok ? "≤" : ">"} ${rule.reference_field}=${ref} × ${rule.factor} (${max})`,
      };
    }
    case "min_confidence": {
      const ok = v !== null && v >= rule.min;
      return {
        rule,
        ok,
        applied: true,
        code: ok ? null : "EXTRACTION_LOW_CONFIDENCE",
        detail: `${rule.field}=${v ?? "missing"} ${ok ? "≥" : "<"} ${rule.min}`,
      };
    }
  }
}

export function checkExtraction(protocol: Protocol, extraction: Record<string, unknown> | null | undefined): ExtractionSanity {
  const rules = protocol.acceptance.extraction_rules ?? [];
  const ex = extraction ?? {};
  const findings = rules.map((r) => evaluate(r, ex));
  const codes = [...new Set(findings.flatMap((f) => (f.code ? [f.code] : [])))];
  return { codes, findings };
}
