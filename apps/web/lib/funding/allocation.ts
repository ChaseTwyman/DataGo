/**
 * Allocation engine: funds researcher data requests from the sponsor pool.
 *
 * Rules
 *  - need          = cells × target per cell × protocol base rate × FUNDING.expectedSurge (rounded up
 *                    to whole dollars): what filling every cell is expected to cost.
 *  - minimum viable = min(need, ceiling price × best quality multiplier × FUNDING.minViableReadings).
 *  - draw order    = earmarks first (one earmarked for this exact request, then protocol/region
 *                    earmarks that match the request's center, oldest first), then the general pool.
 *  - auto-funding guardrails (so one researcher can't lock up the pool): the general pool gives one
 *    request at most FUNDING.autoMaxPerRequestCents and at most FUNDING.autoMaxShareOfGeneral of what
 *    is available, and a researcher with FUNDING.autoMaxLivePerResearcher live funded requests waits
 *    for an admin. Admin approvals/adjustments skip the guardrails (not availability).
 *  - if the planned draws don't reach the minimum viable allocation nothing is drawn: the request
 *    stays pending_funding with a human-readable reason.
 *  - unspent money returns to its buckets when a request closes or ends (general pool first), minus
 *    a hold for locked quotes that may still be paid.
 * Money never moves except through public.pool_allocate (atomic, advisory-locked, append-only).
 */
import type { Protocol } from "@groundtruth/shared";
import { HttpError, conflict } from "../api/http";
import type { Db } from "../db";
import { getBounty, type BountyRow } from "../db/repos/bounties";
import {
  backfillLegacy,
  bucketAvailable,
  committedQuoteCents,
  countFundedLive,
  endedWithAllocation,
  fundingSources,
  heldByBucket,
  listRequests,
  openEarmarks,
  poolAllocate,
  setFundingState,
  type ContributionRow,
} from "../db/repos/funding";
import { getProtocol } from "../db/repos/protocols";
import { PRICING } from "../pricing/config";
import { protocolRate, worstCaseCents } from "../pricing/engine";
import { earmarkCovers } from "../pricing/market";

export const FUNDING = {
  /** Average surge assumed when estimating what a request needs. */
  expectedSurge: 1.5,
  /** A request is only worth funding if it can pay at least this many readings at the ceiling price. */
  minViableReadings: 10,
  /** General-pool cap per auto-funded request. */
  autoMaxPerRequestCents: 25_000,
  /** General-pool share one auto-funded request may take. */
  autoMaxShareOfGeneral: 0.25,
  /** Live funded requests a researcher may hold before new ones wait for an admin. */
  autoMaxLivePerResearcher: 3,
  /** Ended requests keep their allocation this long (late verifications) before it is released. */
  releaseGraceMs: 2 * 3_600_000,
  /** Shown as the sponsor of requests funded mostly by the general pool. */
  poolSponsorName: "GroundTruth sponsor pool",
} as const;

export interface NeedInput {
  cells: number;
  targetPerCell: number;
  protocol: Protocol;
}

export function estimateNeedCents(n: NeedInput): number {
  const rate = protocolRate(n.protocol);
  return Math.ceil((n.cells * n.targetPerCell * rate.baseCents * FUNDING.expectedSurge) / 100) * 100;
}

export function minViableCents(n: NeedInput): number {
  const rate = protocolRate(n.protocol);
  return Math.min(estimateNeedCents(n), Math.ceil(rate.ceilingCents * PRICING.maxQualityMultiplier * FUNDING.minViableReadings));
}

export interface Draw {
  contributionId: string | null;
  cents: number;
}

export interface PlanInput {
  bountyId: string | null;
  protocolSlug: string;
  lat: number;
  lng: number;
  /** Money still wanted. */
  wantCents: number;
  earmarks: (ContributionRow & { available_cents: number })[];
  generalAvailableCents: number;
  /** Apply the auto-funding caps to the general pool. */
  capped: boolean;
}

/** Pure: which buckets fund how much, earmarks first. */
export function planDraws(p: PlanInput): Draw[] {
  const draws: Draw[] = [];
  let want = Math.max(0, Math.floor(p.wantCents));
  const matching = p.earmarks
    .filter((e) => e.available_cents > 0)
    .filter((e) => (e.bounty_id !== null ? e.bounty_id === p.bountyId : earmarkCovers(e, p.protocolSlug, p.lat, p.lng)))
    .sort((a, b) => Number(b.bounty_id !== null) - Number(a.bounty_id !== null) || a.created_at.localeCompare(b.created_at));
  for (const e of matching) {
    if (want <= 0) break;
    const take = Math.min(want, e.available_cents);
    draws.push({ contributionId: e.id, cents: take });
    want -= take;
  }
  if (want > 0 && p.generalAvailableCents > 0) {
    let cap = p.generalAvailableCents;
    if (p.capped) cap = Math.min(cap, FUNDING.autoMaxPerRequestCents, Math.floor(p.generalAvailableCents * FUNDING.autoMaxShareOfGeneral));
    const take = Math.min(want, cap);
    if (take > 0) draws.push({ contributionId: null, cents: take });
  }
  return draws;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const sum = (d: Draw[]) => d.reduce((a, x) => a + x.cents, 0);

export interface AutoDecision {
  draws: Draw[];
  allocationCents: number;
  needCents: number;
  minViableCents: number;
  /** null = fundable now. */
  reason: string | null;
}

/** What the engine would do for a request right now (no writes). */
export async function decideAuto(
  db: Db,
  r: { bountyId: string | null; createdBy: string | null; creatorIsAdmin: boolean; protocol: Protocol; lat: number; lng: number; cells: number; targetPerCell: number; endsAt: string },
  now = new Date(),
): Promise<AutoDecision> {
  const need = estimateNeedCents({ cells: r.cells, targetPerCell: r.targetPerCell, protocol: r.protocol });
  const minViable = minViableCents({ cells: r.cells, targetPerCell: r.targetPerCell, protocol: r.protocol });
  const base = { needCents: need, minViableCents: minViable };
  if (Date.parse(r.endsAt) <= now.getTime()) return { ...base, draws: [], allocationCents: 0, reason: "The request's time window has already ended." };
  const [earmarks, general] = await Promise.all([openEarmarks(db), bucketAvailable(db, null)]);
  const draws = planDraws({
    bountyId: r.bountyId,
    protocolSlug: r.protocol.slug,
    lat: r.lat,
    lng: r.lng,
    wantCents: need,
    earmarks,
    generalAvailableCents: general,
    capped: true,
  });
  // Money earmarked for this exact request is the sponsor's decision: no per-researcher guardrail.
  const specific = draws.some((d) => d.contributionId !== null && earmarks.find((e) => e.id === d.contributionId)?.bounty_id === r.bountyId && r.bountyId !== null);
  if (!r.creatorIsAdmin && r.createdBy && !specific) {
    const live = await countFundedLive(db, r.createdBy, now);
    if (live >= FUNDING.autoMaxLivePerResearcher) {
      return {
        ...base,
        draws: [],
        allocationCents: 0,
        reason: `Waiting for an admin: you already have ${live} funded requests running (automatic funding stops at ${FUNDING.autoMaxLivePerResearcher}).`,
      };
    }
  }
  const total = sum(draws);
  if (total < minViable) {
    return {
      ...base,
      draws: [],
      allocationCents: 0,
      reason: `The sponsor pool can't cover the minimum viable allocation of ${dollars(minViable)} right now (${dollars(total)} available for this request). An admin will review it, or it is funded automatically when sponsors add money.`,
    };
  }
  return { ...base, draws, allocationCents: total, reason: null };
}

/** Sponsor to display on a request: the earmark sponsor holding the majority, else the pool. */
async function displaySponsor(db: Db, bountyId: string): Promise<{ name: string | null; url: string | null }> {
  const src = await fundingSources(db, bountyId);
  const total = src.reduce((a, s) => a + s.cents, 0);
  const top = [...src].filter((s) => s.sponsor_name).sort((a, b) => b.cents - a.cents)[0];
  if (top && total > 0 && top.cents * 2 >= total) return { name: top.sponsor_name, url: top.sponsor_url };
  return total > 0 ? { name: FUNDING.poolSponsorName, url: null } : { name: null, url: null };
}

async function executeDraws(db: Db, bountyId: string, draws: Draw[], kind: "allocate" | "adjust", reason: string, actor: string | null): Promise<void> {
  for (const d of draws) {
    const ok = await poolAllocate(db, { bountyId, contributionId: d.contributionId, cents: d.cents, kind, reason, actor });
    if (!ok) throw conflict("POOL_CHANGED", "The sponsor pool changed while allocating. Please try again.");
  }
}

export interface FundResult {
  bountyId: string;
  status: string;
  allocationCents: number;
  fundingReason: string | null;
}

async function protocolOf(db: Db, b: BountyRow): Promise<Protocol> {
  const p = await getProtocol(db, b.protocol_id);
  if (!p) throw new HttpError(404, "NOT_FOUND", "Protocol not found");
  return p.definition;
}

/** Tries to fund one pending request automatically. Never throws for "not enough money". */
export async function fundRequest(db: Db, bountyId: string, opts: { creatorIsAdmin: boolean }, now = new Date()): Promise<FundResult> {
  const b = await getBounty(db, bountyId);
  if (!b) throw new HttpError(404, "NOT_FOUND", "Request not found");
  if (b.status !== "pending_funding") return { bountyId, status: b.status, allocationCents: b.budget_cents, fundingReason: b.funding_reason };
  const protocol = await protocolOf(db, b);
  const d = await decideAuto(
    db,
    {
      bountyId,
      createdBy: b.created_by,
      creatorIsAdmin: opts.creatorIsAdmin,
      protocol,
      lat: b.center_lat,
      lng: b.center_lng,
      cells: b.cells.length,
      targetPerCell: b.target_per_cell,
      endsAt: b.ends_at,
    },
    now,
  );
  if (d.reason !== null) {
    await setFundingState(db, bountyId, { funding_reason: d.reason });
    return { bountyId, status: "pending_funding", allocationCents: b.budget_cents, fundingReason: d.reason };
  }
  try {
    await db.tx(async (tx) => {
      await executeDraws(tx, bountyId, d.draws, "allocate", "Automatic allocation", null);
      await setFundingState(tx, bountyId, { status: "active", funding_reason: null, markFunded: true, sponsor: await displaySponsor(tx, bountyId) });
    });
  } catch (e) {
    if (e instanceof HttpError && e.code === "POOL_CHANGED") {
      const reason = "The sponsor pool changed while allocating; the engine will retry.";
      await setFundingState(db, bountyId, { funding_reason: reason });
      return { bountyId, status: "pending_funding", allocationCents: b.budget_cents, fundingReason: reason };
    }
    throw e;
  }
  return { bountyId, status: "active", allocationCents: d.allocationCents, fundingReason: null };
}

/** Worst-case value of quotes on this request that may still be paid. */
async function holdCents(db: Db, bountyId: string, now: Date): Promise<number> {
  const q = await committedQuoteCents(db, bountyId, now);
  return q > 0 ? worstCaseCents(q) : 0;
}

/** Releases unspent money back to its buckets (general pool first). Returns cents released. */
export async function releaseUnspent(db: Db, bountyId: string, reason: string, actor: string | null, now = new Date(), keepCents = 0): Promise<number> {
  return db.tx(async (tx) => {
    const b = await getBounty(tx, bountyId);
    if (!b) return 0;
    const hold = await holdCents(tx, bountyId, now);
    let release = b.budget_cents - Math.max(b.spent_cents + hold, keepCents);
    if (release <= 0) return 0;
    let released = 0;
    for (const h of await heldByBucket(tx, bountyId)) {
      if (release <= 0) break;
      const take = Math.min(release, h.cents);
      if (await poolAllocate(tx, { bountyId, contributionId: h.contribution_id, cents: -take, kind: "release", reason, actor })) {
        release -= take;
        released += take;
      }
    }
    return released;
  });
}

/** Admin: approve a pending request or move its allocation to exactly `targetCents`. */
export async function setAllocation(db: Db, bountyId: string, targetCents: number, reason: string, actor: string, now = new Date()): Promise<FundResult> {
  const b = await getBounty(db, bountyId);
  if (!b) throw new HttpError(404, "NOT_FOUND", "Request not found");
  if (b.status === "closed") throw conflict("REQUEST_CLOSED", "This request is closed.");
  const delta = targetCents - b.budget_cents;
  if (delta < 0) {
    const floor = b.spent_cents + (await holdCents(db, bountyId, now));
    if (targetCents < floor) {
      throw conflict("BELOW_COMMITTED", `The allocation can't go below ${dollars(floor)} (already paid out or promised to contributors).`);
    }
    await releaseUnspent(db, bountyId, reason, actor, now, targetCents);
  } else if (delta > 0) {
    const protocol = await protocolOf(db, b);
    const [earmarks, general] = await Promise.all([openEarmarks(db), bucketAvailable(db, null)]);
    const draws = planDraws({
      bountyId,
      protocolSlug: protocol.slug,
      lat: b.center_lat,
      lng: b.center_lng,
      wantCents: delta,
      earmarks,
      generalAvailableCents: general,
      capped: false,
    });
    const total = sum(draws);
    if (total < delta) throw conflict("POOL_INSUFFICIENT", `The pool has only ${dollars(total)} available for this request.`);
    await db.tx(async (tx) => {
      await executeDraws(tx, bountyId, draws, b.budget_cents === 0 ? "allocate" : "adjust", reason, actor);
    });
  }
  const after = (await getBounty(db, bountyId))!;
  const funded = after.budget_cents > after.spent_cents;
  const nextStatus = after.status === "pending_funding" || after.status === "draft" ? (funded ? "active" : undefined) : undefined;
  await setFundingState(db, bountyId, {
    ...(nextStatus ? { status: nextStatus } : {}),
    funding_reason: funded ? null : after.funding_reason,
    markFunded: funded,
    sponsor: await displaySponsor(db, bountyId),
  });
  const final = (await getBounty(db, bountyId))!;
  return { bountyId, status: final.status, allocationCents: final.budget_cents, fundingReason: final.funding_reason };
}

/** Closes a request and returns its unspent allocation to the pool. */
export async function closeRequest(db: Db, bountyId: string, actor: string | null, now = new Date()): Promise<number> {
  await setFundingState(db, bountyId, { status: "closed", funding_reason: null });
  return releaseUnspent(db, bountyId, "Request closed", actor, now);
}

/**
 * The engine's periodic pass: record legacy/demo budgets, release money from requests that ended
 * (after a grace period), then try to fund pending requests oldest first.
 */
export async function runAllocation(db: Db, now = new Date()): Promise<{ funded: number; still_pending: number; released_cents: number }> {
  await backfillLegacy(db);
  let released = 0;
  for (const e of await endedWithAllocation(db, new Date(now.getTime() - FUNDING.releaseGraceMs))) {
    released += await releaseUnspent(db, e.id, "Request ended", null, now);
  }
  let funded = 0;
  let pending = 0;
  const admins = new Set(
    (await db.query<{ id: string }>("select id from public.profiles where is_admin = true")).map((r) => r.id),
  );
  for (const r of await listRequests(db, ["pending_funding"])) {
    const res = await fundRequest(db, r.id, { creatorIsAdmin: r.created_by !== null && admins.has(r.created_by) }, now);
    if (res.status === "active") funded++;
    else pending++;
  }
  return { funded, still_pending: pending, released_cents: released };
}
