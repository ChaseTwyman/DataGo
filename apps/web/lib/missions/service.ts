/**
 * Revisit missions (PRD §2 "how fast water recedes"): when a reading is accepted,
 *   1. it fills an open mission on its cell if it is eligible (window + first dibs) → the reading is
 *      linked to the one that created the mission (submissions.revisit_of) for recession curves;
 *   2. otherwise, if the protocol has a revisit schedule and the cell has no open chain, it becomes
 *      the root of a new chain: follow-ups at +30/+60/+120 min (flood).
 *
 * Missions hold no money. They are demand on a cell that the pricing engine prices ("Revisit due
 * here") and that is paid from the same request allocation through the normal capture flow (gate,
 * quote lock, spendBudget). Creation is capped by what the allocation can still cover at the
 * worst-case price, after locked quotes and the missions already open on the request.
 *
 * Called after the pipeline accepts (submissions route) and after a reviewer approves. Never throws
 * into the caller: missions are best-effort and must not fail a payout.
 */
import { missionToFill, planRevisits, revisitConfig, type PlanSkip } from "@groundtruth/shared";
import type { Db } from "../db";
import { getBounty } from "../db/repos/bounties";
import { getProtocol } from "../db/repos/protocols";
import { getSubmission } from "../db/repos/submissions";
import { loadPricing } from "../pricing/market";
import { PRICING } from "../pricing/config";
import { worstCaseCents } from "../pricing/engine";
import { expireMissions, fillableMissions, fillMission, insertMissions, openMissions } from "./repo";

export type MissionOutcome =
  | { kind: "filled"; missionId: string; revisitOf: string }
  | { kind: "created"; count: number; limitedBy: PlanSkip | null }
  | { kind: "skipped"; reason: string };

export async function onSubmissionAccepted(db: Db, submissionId: string, now = new Date()): Promise<MissionOutcome> {
  try {
    return await handle(db, submissionId, now);
  } catch (err) {
    console.error("[missions] accept hook failed", submissionId, err);
    return { kind: "skipped", reason: "error" };
  }
}

async function handle(db: Db, submissionId: string, now: Date): Promise<MissionOutcome> {
  const sub = await getSubmission(db, submissionId);
  if (!sub || sub.status !== "accepted") return { kind: "skipped", reason: "not_accepted" };
  const bounty = await getBounty(db, sub.bounty_id);
  if (!bounty) return { kind: "skipped", reason: "no_bounty" };
  const protocol = await getProtocol(db, bounty.protocol_id);
  const cfg = protocol ? revisitConfig(protocol.definition) : null;
  if (!protocol || !cfg) return { kind: "skipped", reason: "no_revisit_schedule" };

  const link = (await db.query<{ mission_id: string | null; revisit_of: string | null }>(
    "select mission_id, revisit_of from public.submissions where id = $1",
    [submissionId],
  ))[0];
  if (link?.mission_id) return { kind: "skipped", reason: "already_linked" };

  // 1. Fill an open mission on this cell.
  // Judged at capture time: an "expired" mission is still fillable by a reading captured in its window.
  const fillable = (await fillableMissions(db, bounty.id, sub.h3_cell, sub.captured_at)).map((m) => ({ ...m, status: "open" as const }));
  const target = missionToFill(fillable, { submissionId, userId: sub.user_id, bountyId: bounty.id, cell: sub.h3_cell, capturedAt: sub.captured_at });
  if (target && (await fillMission(db, target.id, submissionId, target.source_submission_id, now))) {
    return { kind: "filled", missionId: target.id, revisitOf: target.source_submission_id };
  }
  if (link?.revisit_of) return { kind: "skipped", reason: "is_revisit" };
  await expireMissions(db, now);

  // 2. Root a new chain (one open chain per cell; serialised per request).
  if (bounty.status !== "active") return { kind: "skipped", reason: "request_not_active" };
  return db.tx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(7340010, hashtext($1))", [bounty.id]);
    const stillOpen = await openMissions(tx, { bountyId: bounty.id, now });
    // One chain per cell at a time: a chain still running (any mission not yet past its window,
    // filled or not) blocks a new root, so fills can't be chained into endless follow-ups.
    const running = await tx.query<{ n: number }>(
      "select count(*)::int as n from public.missions where bounty_id = $1 and cell = $2 and status <> 'cancelled' and closes_at > $3::timestamptz",
      [bounty.id, sub.h3_cell, now.toISOString()],
    );
    if ((running[0]?.n ?? 0) > 0) return { kind: "skipped", reason: "cell_has_running_chain" } as const;
    const pricing = await loadPricing(tx, bounty, protocol.definition, now);
    const here = pricing.cells.find((c) => c.cell === sub.h3_cell);
    if (!here) return { kind: "skipped", reason: "cell_not_in_request" } as const;
    // Never send people back into a hazard-paused cell.
    if (here.paused) return { kind: "skipped", reason: "hazard_paused" } as const;
    const boosted = Math.min(pricing.rate.ceilingCents, Math.ceil(Math.max(here.price_cents, pricing.rate.floorCents) * PRICING.revisit.boost));
    const perMission = worstCaseCents(boosted);
    const available = pricing.remainingCents - stillOpen.length * perMission;
    const plan = planRevisits({ cfg, capturedAt: sub.captured_at, now, bountyEndsAt: bounty.ends_at, availableCents: available, perMissionCents: perMission });
    if (plan.missions.length === 0) return { kind: "skipped", reason: plan.limitedBy ?? "nothing_to_plan" } as const;
    const count = await insertMissions(
      tx,
      plan.missions.map((m) => ({ ...m, bounty_id: bounty.id, cell: sub.h3_cell, source_submission_id: submissionId, original_user_id: sub.user_id })),
    );
    return { kind: "created", count, limitedBy: plan.limitedBy } as const;
  });
}
