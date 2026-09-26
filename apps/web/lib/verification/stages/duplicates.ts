/**
 * Layer 6 — duplicates and velocity (PRD §9.2): dHash against every prior submission (Hamming ≤ 6 →
 * DUPLICATE), ≤ 6 submissions per user per cell per hour, and impossible travel (> 150 km/h) between
 * a user's consecutive submissions.
 */
import { haversineM, type ReasonCode, type Subcheck } from "@groundtruth/shared";
import { DUPLICATE_MAX_HAMMING, hamming } from "../../image/dhash";
import type { Stage, StageOutcome } from "../types";

export const VELOCITY_MAX_PER_HOUR = 6;
export const MAX_TRAVEL_KMH = 150;
/** Ignore GPS jitter: travel checks only apply beyond this distance. */
export const TRAVEL_MIN_DISTANCE_M = 1000;

export const duplicates: Stage = {
  id: "duplicates",
  async run(ctx): Promise<StageOutcome> {
    const { input, deps } = ctx;
    const sub: Subcheck[] = [];
    const codes: ReasonCode[] = [];
    const evidence: string[] = [];

    const hashes = await ctx.hashes();
    const prior = await deps.priorHashes(input.submissionId);
    let best: { id: string; d: number } | null = null;
    for (const p of prior) {
      for (const h of p.phashes) {
        for (const mine of hashes) {
          const d = hamming(h, mine);
          if (!best || d < best.d) best = { id: p.id, d };
        }
      }
    }
    if (best && best.d <= DUPLICATE_MAX_HAMMING) {
      codes.push("DUPLICATE");
      sub.push({ id: "phash", label: "Not a duplicate", status: "fail", detail: `Matches an earlier submission (Hamming ${best.d})` });
      evidence.push(`Near-identical to submission ${best.id.slice(0, 8)} (dHash distance ${best.d} ≤ ${DUPLICATE_MAX_HAMMING})`);
    } else {
      sub.push({ id: "phash", label: "Not a duplicate", status: "pass", detail: best ? `Closest prior image: Hamming ${best.d}` : "No prior images" });
    }

    if (input.userId) {
      const since = new Date(Date.parse(input.captured_at) - 3600_000).toISOString();
      const n = await deps.countUserCellSince(input.userId, input.h3_cell, since, input.submissionId);
      const ok = n < VELOCITY_MAX_PER_HOUR;
      sub.push({ id: "velocity", label: "Submission rate", status: ok ? "pass" : "warn", detail: `${n} other submission(s) in this cell in the past hour` });
      if (!ok) codes.push("VELOCITY_LIMIT");

      const prev = await deps.previousUserSubmission(input.userId, input.captured_at, input.submissionId);
      if (prev) {
        const dist = haversineM(prev.lat, prev.lng, input.lat, input.lng);
        const hours = (Date.parse(input.captured_at) - Date.parse(prev.captured_at)) / 3_600_000;
        const kmh = hours > 0 ? dist / 1000 / hours : Number.POSITIVE_INFINITY;
        const impossible = dist > TRAVEL_MIN_DISTANCE_M && kmh > MAX_TRAVEL_KMH;
        sub.push({
          id: "travel",
          label: "Plausible travel",
          status: impossible ? "warn" : "pass",
          detail: `${(dist / 1000).toFixed(1)} km since previous submission${Number.isFinite(kmh) ? ` (${Math.round(kmh)} km/h)` : ""}`,
        });
        if (impossible) codes.push("IMPOSSIBLE_TRAVEL");
      } else {
        sub.push({ id: "travel", label: "Plausible travel", status: "skipped", detail: "No previous submission" });
      }
    }

    const failed = codes.includes("DUPLICATE");
    const warned = codes.length > 0;
    return {
      status: failed ? "fail" : warned ? "warn" : "pass",
      score: failed ? 0 : warned ? 0.5 : 1,
      reasonCodes: codes,
      evidence: evidence.length ? evidence : [`${hashes.length} frame hash(es) checked against ${prior.length} prior submission(s)`],
      subchecks: sub,
    };
  },
};
