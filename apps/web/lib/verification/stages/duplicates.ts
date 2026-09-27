/**
 * Layer 6 — duplicates and velocity (PRD §9.2): dHash against every prior submission (Hamming ≤ 6 →
 * DUPLICATE), ≤ 6 submissions per user per cell per hour, and impossible travel (> 150 km/h) between
 * a user's consecutive submissions.
 *
 * Revisits (missions, migration 000010): a genuine +30/+60/+120 min revisit of the same spot with
 * the same framing can be near-identical by dHash. A match is downgraded to REVISIT_SIMILAR (warn,
 * capped at needs_review, never auto-accepted) only when EVERY matching prior is on the same bounty
 * and H3 cell, was captured one revisit interval earlier (protocol.revisit), and the burst is not
 * a pixel-exact copy (every frame at dHash distance 0 to that prior = re-submitted images, e.g. the
 * red team's "recycled" attack). Anything else stays a DUPLICATE hard fail.
 */
import { haversineM, type Protocol, type ReasonCode, type Subcheck } from "@groundtruth/shared";
import type { PriorHashes } from "../../db/repos/submissions";
import { DUPLICATE_MAX_HAMMING, hamming } from "../../image/dhash";
import type { Stage, StageOutcome } from "../types";

export const VELOCITY_MAX_PER_HOUR = 6;
export const MAX_TRAVEL_KMH = 150;
/** Ignore GPS jitter: travel checks only apply beyond this distance. */
export const TRAVEL_MIN_DISTANCE_M = 1000;

/** [min, max] minutes between a reading and a revisit of it, from the protocol's revisit schedule. */
export function revisitGapRange(protocol: Protocol): [number, number] | null {
  const r = protocol.revisit;
  if (!r || r.intervals_min.length === 0) return null;
  return [Math.min(...r.intervals_min) - (r.early_min ?? 0), Math.max(...r.intervals_min) + (r.window_min ?? 0)];
}

/** A near-identical prior that may be the earlier reading of a genuine revisit (see header). */
export function isRevisitOf(
  prior: PriorHashes,
  mine: { bountyId: string; cell: string; capturedAt: string; hashes: string[] },
  gap: [number, number] | null,
): boolean {
  if (!gap || !prior.captured_at || prior.bounty_id !== mine.bountyId || prior.h3_cell !== mine.cell) return false;
  const minutes = (Date.parse(mine.capturedAt) - Date.parse(prior.captured_at)) / 60_000;
  if (!(minutes >= gap[0] && minutes <= gap[1])) return false;
  const exactCopy = mine.hashes.length > 0 && mine.hashes.every((h) => prior.phashes.some((p) => hamming(p, h) === 0));
  return !exactCopy;
}

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
    const matches: PriorHashes[] = [];
    for (const p of prior) {
      let pBest = Number.POSITIVE_INFINITY;
      for (const h of p.phashes) {
        for (const mine of hashes) {
          const d = hamming(h, mine);
          pBest = Math.min(pBest, d);
          if (!best || d < best.d) best = { id: p.id, d };
        }
      }
      if (pBest <= DUPLICATE_MAX_HAMMING) matches.push(p);
    }
    const gap = revisitGapRange(input.protocol);
    const mine = { bountyId: input.bounty.id, cell: input.h3_cell, capturedAt: input.captured_at, hashes };
    const revisit = matches.length > 0 && matches.every((p) => isRevisitOf(p, mine, gap));
    if (revisit && best) {
      codes.push("REVISIT_SIMILAR");
      sub.push({
        id: "phash",
        label: "Not a duplicate",
        status: "warn",
        detail: `Near-identical to an earlier reading of this cell one revisit interval ago (Hamming ${best.d}); a reviewer confirms it`,
      });
      evidence.push(`Similar to earlier reading ${best.id.slice(0, 8)} of the same cell (dHash distance ${best.d}), captured one revisit interval earlier`);
    } else if (best && best.d <= DUPLICATE_MAX_HAMMING) {
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
