/**
 * Layer 7 — corroboration and reputation (PRD §9.2, simplified for the MVP): accepted observations of
 * the same bounty within `corroboration_radius_m` / `corroboration_window_min` whose numeric field
 * (flood: depth_cm) agrees within ±tolerance (default 10) boost confidence; disagreement lowers it;
 * none is neutral (0.5). Trust score is reported here and weighed by decide().
 */
import { haversineM, type Subcheck } from "@groundtruth/shared";
import type { Stage, StageOutcome } from "../types";

export const DEFAULT_TOLERANCE = 10;

export function corroborationField(props: Record<string, unknown>, configured?: string): string | null {
  if (configured) return configured;
  return "depth_cm" in props ? "depth_cm" : null;
}

export const corroboration: Stage = {
  id: "corroboration",
  async run(ctx): Promise<StageOutcome> {
    const { input, deps } = ctx;
    const acc = input.protocol.acceptance;
    const sub: Subcheck[] = [];
    const evidence: string[] = [];
    let score = 0.5;
    let status: StageOutcome["status"] = "pass";

    const field = corroborationField(input.protocol.extraction_schema.properties, acc.corroboration_field);
    const tol = acc.corroboration_tolerance ?? DEFAULT_TOLERANCE;
    let mine: number | null = null;
    try {
      const v = (await ctx.model()).extraction[field ?? ""];
      mine = typeof v === "number" ? v : null;
    } catch {
      mine = null;
    }

    if (!field || mine === null) {
      sub.push({ id: "neighbors", label: "Nearby agreement", status: "skipped", detail: field ? `No ${field} extracted` : "Protocol has no corroboration field" });
    } else {
      const near = (await deps.acceptedNear(input.bounty.id, input.captured_at, acc.corroboration_window_min, input.submissionId)).filter(
        (o) => haversineM(o.lat, o.lng, input.lat, input.lng) <= acc.corroboration_radius_m,
      );
      const values = near.map((o) => o.extracted?.[field]).filter((v): v is number => typeof v === "number");
      if (values.length === 0) {
        sub.push({ id: "neighbors", label: "Nearby agreement", status: "skipped", detail: `No accepted observations within ${acc.corroboration_radius_m} m / ${acc.corroboration_window_min} min` });
        evidence.push("No nearby observations to compare");
      } else {
        const agree = values.filter((v) => Math.abs(v - mine!) <= tol).length;
        if (agree > 0) {
          score = Math.min(1, 0.7 + 0.15 * agree);
          sub.push({ id: "neighbors", label: "Nearby agreement", status: "pass", detail: `${agree} of ${values.length} nearby readings within ±${tol}` });
        } else {
          score = 0.2;
          status = "warn";
          sub.push({ id: "neighbors", label: "Nearby agreement", status: "warn", detail: `0 of ${values.length} nearby readings within ±${tol}` });
        }
        evidence.push(`${field}=${mine} vs nearby [${values.join(", ")}]`);
      }
    }

    const trustLow = input.trustScore < 0.3;
    sub.push({ id: "trust", label: "Contributor trust", status: trustLow ? "warn" : "pass", detail: input.trustScore.toFixed(2) });
    if (trustLow) status = "warn";
    evidence.push(`Contributor trust ${input.trustScore.toFixed(2)}`);
    return { status, score, reasonCodes: [], evidence, subchecks: sub };
  },
};
