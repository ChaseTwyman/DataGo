/** Live per-cell prices (PRD §10) for a bounty: scarcity from accepted counts, urgency, hazard pause. */
import {
  computePrice,
  hoursBetween,
  urgencyTauHours,
  type CellPrice,
  type Protocol,
} from "@groundtruth/shared";
import type { Db } from "./db";
import { acceptedByCell, type BountyRow } from "./db/repos/bounties";
import { pausedCells } from "./hazards";

export function computeCoverage(
  bounty: BountyRow,
  protocol: Protocol,
  accepted: Map<string, number>,
  paused: Map<string, string>,
  now: Date,
): CellPrice[] {
  const hours = bounty.event_started_at ? Math.max(0, hoursBetween(bounty.event_started_at, now)) : null;
  const tau = urgencyTauHours(protocol);
  return bounty.cells.map((cell) => {
    const n = accepted.get(cell) ?? 0;
    const reason = paused.get(cell) ?? null;
    const p = computePrice({
      baseCents: bounty.base_price_cents,
      maxCents: bounty.max_price_cents,
      acceptedInCell: n,
      targetPerCell: bounty.target_per_cell,
      hoursSinceEventStart: hours,
      tauHours: tau,
      priority: bounty.priority,
      inHazard: reason !== null,
    });
    return {
      cell,
      accepted: n,
      target: bounty.target_per_cell,
      price_cents: p.priceCents,
      surge: p.surge,
      paused: reason !== null,
      paused_reason: reason,
    };
  });
}

export async function loadCoverage(db: Db, bounty: BountyRow, protocol: Protocol, now = new Date()): Promise<CellPrice[]> {
  const [accepted, paused] = await Promise.all([acceptedByCell(db, bounty.id), pausedCells(db, bounty, now)]);
  return computeCoverage(bounty, protocol, accepted, paused, now);
}

export const budgetRemaining = (b: Pick<BountyRow, "budget_cents" | "spent_cents">) => Math.max(0, b.budget_cents - b.spent_cents);
