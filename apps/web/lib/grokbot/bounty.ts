/**
 * Bounty-side Grokbot: contributor "why this price?" (Phase 3), request status for the owner
 * (Phase 4), and the pool-aware funding estimate on Radar drafts (Phase 4).
 *
 * Price: grounded ONLY in what the phone already shows (price, surge, price_reasons, the public
 * base/ceiling) plus the public quote-lock rule. The engine's factors, weights, and the allocation
 * are never put in the case file, so neither the model nor a template can repeat them.
 */
import {
  QUOTE_TTL_MIN,
  cellForPoint,
  cellsForCircle,
  DEMO,
  type GrokbotMessage,
  type Protocol,
  type RadarFunding,
} from "@groundtruth/shared";
import type { Db } from "../db";
import { acceptedByCell, type BountyRow } from "../db/repos/bounties";
import { bucketAvailable, committedQuoteCents, countFundedLive, openEarmarks } from "../db/repos/funding";
import type { ProtocolRow } from "../db/repos/protocols";
import { decideAuto, estimateNeedCents, FUNDING, minViableCents } from "../funding/allocation";
import { earmarkLabel, paceLabel } from "../funding/labels";
import { earmarkCovers, loadPricing } from "../pricing/market";
import { dollars } from "./caseFile";
import { composeMessage, type Generate } from "./compose";
import { priceWhyTemplate, statusTemplate } from "./templates";
import type { CaseFile, Fact } from "./types";

// ---------------------------------------------------------------- price why

export async function priceCase(db: Db, b: BountyRow, p: ProtocolRow, lat: number, lng: number, now = new Date()): Promise<CaseFile> {
  const pricing = await loadPricing(db, b, p.definition, now);
  const here = cellForPoint(lat, lng);
  const open = pricing.cells.filter((c) => !c.paused);
  const pick = pricing.cells.find((c) => c.cell === here) ?? [...open].sort((a, c) => c.price_cents - a.price_cents)[0] ?? pricing.cells[0];
  const facts: Fact[] = [];
  const price = pick?.price_cents ?? pricing.rate.baseCents;
  const surge = pick?.surge ?? 1;
  const inside = pick?.cell === here;
  facts.push({
    id: "price.current",
    citation: { kind: "price_reason", ref: "price", detail: dollars(price) },
    text: `${inside ? "The price where you are" : "The best open price in this bounty"} is ${dollars(price)}${surge > 1 ? `, ${surge}x the base price` : ""}.`,
  });
  (pick?.price_reasons ?? []).slice(0, 6).forEach((r, i) =>
    facts.push({ id: `price.reason.${i}`, citation: { kind: "price_reason", ref: r.slice(0, 120), detail: null }, text: `Price note: ${r}.` }),
  );
  facts.push({
    id: "price.range",
    citation: { kind: "price_reason", ref: "range", detail: null },
    text: `This protocol pays from ${dollars(pricing.rate.baseCents)} to ${dollars(pricing.rate.ceilingCents)} per accepted reading, before the quality adjustment.`,
  });
  if (pick?.paused) {
    facts.push({ id: "price.paused", citation: { kind: "alert", ref: "paused", detail: pick.paused_reason }, text: `Captures are paused here for safety${pick.paused_reason ? ` (${pick.paused_reason})` : ""}.` });
  }
  facts.push({
    id: "price.lock",
    citation: { kind: "price_reason", ref: "quote_lock", detail: null },
    text: `Starting a capture locks the price for ${QUOTE_TTL_MIN} minutes; the payout is that price adjusted for capture quality.`,
  });
  return { kind: "price_why", subjectId: `${b.id}:${pick?.cell ?? "none"}`, audience: "public", facts, untrusted: [], injectionFlags: [] };
}

export async function priceWhy(db: Db, b: BountyRow, p: ProtocolRow, lat: number, lng: number, o: { mockError?: boolean; generate?: Generate } = {}): Promise<GrokbotMessage> {
  const c = await priceCase(db, b, p, lat, lng);
  return composeMessage(db, {
    op: "price_why",
    caseFile: c,
    task: "Explain to a contributor, in two or three short sentences, why this bounty pays this price where they are. Use only the price notes given; do not describe how prices are computed beyond them.",
    template: priceWhyTemplate(c),
    ttlSeconds: 600,
    ...(o.mockError ? { mockError: true } : {}),
    ...(o.generate ? { generate: o.generate } : {}),
  });
}

// ---------------------------------------------------------------- request status

export async function statusCase(db: Db, b: BountyRow, p: ProtocolRow, now = new Date()): Promise<CaseFile> {
  const facts: Fact[] = [];
  const status = b.status.replace("_", " ");
  facts.push({ id: "bounty.status", citation: { kind: "pool", ref: "status", detail: b.status }, text: `This request is ${status}.` });
  if (b.funding_reason) facts.push({ id: "bounty.funding_reason", citation: { kind: "pool", ref: "funding_reason", detail: null }, text: `Allocator: ${b.funding_reason}` });
  const need = estimateNeedCents({ cells: b.cells.length, targetPerCell: b.target_per_cell, protocol: p.definition });
  const minViable = minViableCents({ cells: b.cells.length, targetPerCell: b.target_per_cell, protocol: p.definition });
  facts.push({
    id: "bounty.need",
    citation: { kind: "pool", ref: "estimated_need", detail: dollars(need) },
    text: `Estimated need: ${dollars(need)} for ${b.cells.length} cells at ${b.target_per_cell} readings each; the minimum viable allocation is ${dollars(minViable)}.`,
  });
  const committed = await committedQuoteCents(db, b.id, now);
  facts.push({
    id: "bounty.allocation",
    citation: { kind: "pool", ref: "allocation", detail: dollars(b.budget_cents) },
    text: `Allocated ${dollars(b.budget_cents)}, paid out ${dollars(b.spent_cents)}, ${dollars(committed)} in open price quotes.`,
  });
  if (b.status === "pending_funding") {
    const general = await bucketAvailable(db, null);
    const earmarks = (await openEarmarks(db)).filter((e) => (e.bounty_id !== null ? e.bounty_id === b.id : earmarkCovers(e, p.slug, b.center_lat, b.center_lng)));
    const earmarked = earmarks.reduce((a, e) => a + e.available_cents, 0);
    facts.push({
      id: "pool.general",
      citation: { kind: "pool", ref: "general_available", detail: dollars(general) },
      text: `The general sponsor pool has ${dollars(general)} available; earmarks matching this request hold ${dollars(earmarked)}${earmarks.length ? ` (${earmarks.map((e) => earmarkLabel(e)).slice(0, 2).join("; ")})` : ""}.`,
    });
    if (b.created_by) {
      const live = await countFundedLive(db, b.created_by, now);
      facts.push({ id: "researcher.live", citation: { kind: "pool", ref: "live_requests", detail: String(live) }, text: `The requester has ${live} funded requests running; automatic funding stops at ${FUNDING.autoMaxLivePerResearcher}.` });
    }
  }
  if (b.status === "active" || b.status === "paused") {
    const pace = paceLabel(b.budget_cents, b.spent_cents + committed, b.starts_at, b.ends_at, now);
    facts.push({ id: "bounty.pace", citation: { kind: "pool", ref: "pace", detail: pace }, text: `Budget pacing: ${pace.replace("_", " ")}.` });
    const acc = await acceptedByCell(db, b.id);
    const done = b.cells.filter((c) => (acc.get(c) ?? 0) >= b.target_per_cell).length;
    facts.push({ id: "bounty.coverage", citation: { kind: "pool", ref: "coverage", detail: null }, text: `${done} of ${b.cells.length} cells have reached their target.` });
    const pricing = await loadPricing(db, b, p.definition, now);
    const paused = pricing.cells.filter((c) => c.paused).length;
    if (paused > 0) facts.push({ id: "bounty.paused_cells", citation: { kind: "alert", ref: "paused_cells", detail: String(paused) }, text: `${paused} cells are paused by a hazard warning.` });
  }
  const ended = Date.parse(b.ends_at) <= now.getTime();
  facts.push({ id: "bounty.window", citation: { kind: "pool", ref: "window", detail: b.ends_at }, text: ended ? `The request window ended at ${b.ends_at}.` : `The request window runs until ${b.ends_at}.` });
  return { kind: "status", subjectId: b.id, audience: "researcher", facts, untrusted: [], injectionFlags: [] };
}

export async function requestStatus(db: Db, b: BountyRow, p: ProtocolRow, o: { mockError?: boolean; generate?: Generate } = {}): Promise<GrokbotMessage> {
  const c = await statusCase(db, b, p);
  return composeMessage(db, {
    op: "status",
    caseFile: c,
    task: "Explain to the researcher where this data request stands (funded, waiting for funding and why, paused, or pacing) and what would help next. Suggestions must follow from the facts; funding and approvals are done by people, not by you.",
    template: statusTemplate(c),
    ttlSeconds: 900,
    ...(o.mockError ? { mockError: true } : {}),
    ...(o.generate ? { generate: o.generate } : {}),
  });
}

// ---------------------------------------------------------------- radar funding

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What the allocator would do for a draft right now (no writes). */
export async function estimateDraftFunding(
  db: Db,
  d: { protocol: Protocol; center_lat: number; center_lng: number; radius_m: number },
  who: { id: string; isAdmin: boolean },
  now = new Date(),
): Promise<RadarFunding> {
  let cells = cellsForCircle(d.center_lat, d.center_lng, d.radius_m);
  if (cells.length === 0) cells = cellsForCircle(d.center_lat, d.center_lng, 50);
  const decision = await decideAuto(
    db,
    {
      bountyId: null,
      createdBy: who.id,
      creatorIsAdmin: who.isAdmin,
      protocol: d.protocol,
      lat: d.center_lat,
      lng: d.center_lng,
      cells: cells.length,
      targetPerCell: DEMO.targetPerCell,
      endsAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
    },
    now,
  );
  if (decision.reason === null) {
    return {
      fundable: true,
      estimated_allocation_cents: decision.allocationCents,
      reason: clip(`The pool would allocate about ${dollars(decision.allocationCents)} of the ${dollars(decision.needCents)} this needs (${cells.length} cells at ${DEMO.targetPerCell} readings each).`, 240),
    };
  }
  return { fundable: false, estimated_allocation_cents: 0, reason: clip(decision.reason, 240) };
}

/** One-paragraph pool summary for the Radar prompt, so it proposes scopes the pool can fund. */
export async function poolSummaryForRadar(db: Db): Promise<string> {
  const [general, earmarks] = await Promise.all([bucketAvailable(db, null), openEarmarks(db)]);
  const marks = earmarks
    .filter((e) => e.bounty_id === null)
    .slice(0, 5)
    .map((e) => `${earmarkLabel(e)}: ${dollars(e.available_cents)}`);
  return [
    `Sponsor pool: general pool ${dollars(general)} available (one automatically funded request may take at most ${dollars(FUNDING.autoMaxPerRequestCents)} and ${Math.round(FUNDING.autoMaxShareOfGeneral * 100)}% of it).`,
    marks.length ? `Earmarked money: ${marks.join("; ")}.` : "No open earmarks.",
    "A request is fundable only if the pool covers its minimum viable allocation; smaller radii need less. Prefer scopes the pool can fund, and say so in the rationale.",
  ].join(" ");
}
