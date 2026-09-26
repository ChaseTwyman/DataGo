/**
 * GroundTruth pricing engine (server-only; never imported by client code). Pure functions: the
 * database-facing loader is lib/pricing/market.ts.
 *
 * price(cell) = clamp(base × S × U × D × Y × P, floor, ceiling), then "fit" to the allocation.
 *
 *  base  Protocol base rate: effort-derived (capture difficulty × safety level × travel) unless the
 *        protocol has an override in PRICING.protocols. Floor = base, ceiling = base × 5 by default.
 *  S     Scarcity — readings still missing in the cell: 1 + α·max(0, 1 − accepted/target).
 *  U     Urgency — recent events pay more: 1 + β·exp(−hours since event/τ). Forced to 1 in
 *        hazard-paused cells (never reward rushing toward danger).
 *  D     Demand — other funded requests / sponsor earmarks wanting the same cell and protocol.
 *  Y     Supply — few contributors active nearby recently → small boost; many → small discount.
 *  P     Pacing — allocation left vs time left: slows spend when burning too fast, boosts when
 *        under-spending.
 *  fit   If Σ (readings still needed × price × best quality multiplier) exceeds the remaining
 *        allocation, every price is scaled down (never below the floor) so the expected payout
 *        stays within the allocation. Sessions are refused when the allocation can't cover a quote.
 *
 * Payout stays locked quote × quality multiplier (0.8–1.2) with the 15-minute price lock.
 */
import type { CellPrice, Protocol } from "@groundtruth/shared";
import { PRICING, type PricingConfig } from "./config";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface ProtocolRate {
  baseCents: number;
  floorCents: number;
  ceilingCents: number;
}

/** Effort multiplier from the protocol's capture difficulty and safety level. */
export function effortMultiplier(protocol: Protocol, cfg: PricingConfig = PRICING): number {
  const c = protocol.capture;
  const difficulty =
    1 +
    cfg.effort.perExtraFrame * Math.max(0, c.frames - 1) +
    cfg.effort.perRequiredElement * c.required_elements.length +
    cfg.effort.perFieldQuestion * c.field_questions.length;
  return difficulty * (cfg.safety[protocol.safety.level] ?? 1);
}

/** Base rate, floor and ceiling for a protocol (override → effort-derived default). */
export function protocolRate(protocol: Protocol, cfg: PricingConfig = PRICING): ProtocolRate {
  const o = cfg.protocols[protocol.slug] ?? {};
  const derived = cfg.baseRateCents * effortMultiplier(protocol, cfg) * (o.travel ?? 1);
  const baseCents = Math.max(cfg.roundToCents, o.baseCents ?? Math.round(derived / cfg.roundToCents) * cfg.roundToCents);
  const floorCents = Math.max(1, o.floorCents ?? baseCents);
  const ceilingCents = Math.max(floorCents, o.ceilingCents ?? baseCents * cfg.ceilingMultiple);
  return { baseCents, floorCents, ceilingCents };
}

export function scarcityFactor(accepted: number, target: number, cfg: PricingConfig = PRICING): number {
  if (target <= 0) return 1;
  return 1 + cfg.scarcity.alpha * Math.max(0, 1 - accepted / target);
}

export function urgencyFactor(hoursSinceEvent: number | null, tauHours: number, inHazard: boolean, cfg: PricingConfig = PRICING): number {
  // An event that hasn't started (future timestamp) earns no urgency: the field is requester-set.
  if (inHazard || hoursSinceEvent === null || hoursSinceEvent < 0 || tauHours <= 0) return 1;
  return 1 + cfg.urgency.beta * Math.exp(-hoursSinceEvent / tauHours);
}

/** otherWants = other funded requests + matching sponsor earmarks for this cell/protocol. */
export function demandFactor(otherWants: number, cfg: PricingConfig = PRICING): number {
  return 1 + cfg.demand.gamma * clamp(Math.floor(otherWants), 0, cfg.demand.maxExtra);
}

/** activeContributors = distinct contributors with a session near the cell in the supply window. */
export function supplyFactor(activeContributors: number, cfg: PricingConfig = PRICING): number {
  const hi = 1 + cfg.supply.maxBoost;
  return clamp(hi - cfg.supply.perActive * Math.max(0, activeContributors), cfg.supply.min, hi);
}

export interface PacingInput {
  allocationCents: number;
  spentCents: number;
  /** Locked quotes that may still be paid (open sessions, submissions being verified), worst case. */
  committedCents: number;
  startsAt: string;
  endsAt: string;
  now: Date;
}

export function remainingAllocation(p: Pick<PacingInput, "allocationCents" | "spentCents" | "committedCents">): number {
  return Math.max(0, p.allocationCents - p.spentCents - p.committedCents);
}

/** (allocation share left ÷ time share left) ^ kappa, clamped. 1 when there is no allocation. */
export function pacingFactor(p: PacingInput, cfg: PricingConfig = PRICING): number {
  if (p.allocationCents <= 0) return 1;
  const budgetShare = remainingAllocation(p) / p.allocationCents;
  const start = Date.parse(p.startsAt);
  const end = Date.parse(p.endsAt);
  const total = end - start;
  const timeShare = total > 0 ? clamp((end - p.now.getTime()) / total, 0.02, 1) : 1;
  return clamp(Math.pow(budgetShare / timeShare, cfg.pacing.kappa), cfg.pacing.min, cfg.pacing.max);
}

export interface CellMarket {
  cell: string;
  accepted: number;
  target: number;
  pausedReason: string | null;
  otherWants: number;
  activeContributors: number;
}

export interface CellFactors {
  scarcity: number;
  urgency: number;
  demand: number;
  supply: number;
  /** Pacing including the allocation fit. */
  pacing: number;
}

export interface PricedCell extends CellPrice {
  factors: CellFactors;
  price_reasons: string[];
}

export interface PriceCellsInput {
  rate: ProtocolRate;
  tauHours: number;
  hoursSinceEvent: number | null;
  cells: CellMarket[];
  pacing: PacingInput;
}

export interface PriceCellsResult {
  cells: PricedCell[];
  /** Scale applied by the allocation fit (1 = no scaling needed). */
  fit: number;
  /** Σ over open cells of readings still needed × price × best quality multiplier. */
  expectedPayoutCents: number;
  remainingCents: number;
}

/** Human-readable reasons for the phone ("why is this price what it is"), strongest first. */
export function priceReasons(f: CellFactors, s: { paused: boolean; atCeiling: boolean; atFloor: boolean; covered: boolean }): string[] {
  const out: { w: number; text: string }[] = [];
  if (s.paused) out.push({ w: 10, text: "Paused for safety" });
  if (s.covered) out.push({ w: 0.5, text: "Enough readings here already" });
  else if (f.scarcity >= 2) out.push({ w: f.scarcity, text: "Few readings here" });
  else if (f.scarcity > 1.2) out.push({ w: f.scarcity, text: "More readings needed here" });
  if (f.urgency >= 1.25) out.push({ w: f.urgency, text: "Event is recent" });
  if (f.demand >= 1.1) out.push({ w: f.demand, text: "High demand" });
  if (f.supply >= 1.05) out.push({ w: f.supply, text: "Few contributors nearby" });
  else if (f.supply <= 0.95) out.push({ w: 2 - f.supply, text: "Many contributors nearby" });
  if (f.pacing >= 1.1) out.push({ w: f.pacing, text: "Boost to finish on time" });
  else if (f.pacing <= 0.9) out.push({ w: 2 - f.pacing, text: "Budget is being paced" });
  if (s.atCeiling) out.push({ w: 0.1, text: "At the maximum price" });
  else if (s.atFloor && !s.paused) out.push({ w: 0.05, text: "Base price" });
  return out.sort((a, b) => b.w - a.w).map((r) => r.text);
}

/** Prices every cell of one request. Deterministic for a given market snapshot. */
export function priceCells(input: PriceCellsInput, cfg: PricingConfig = PRICING): PriceCellsResult {
  const { rate } = input;
  const pace = pacingFactor(input.pacing, cfg);
  const pre = input.cells.map((c) => {
    const inHazard = c.pausedReason !== null;
    const f = {
      scarcity: scarcityFactor(c.accepted, c.target, cfg),
      urgency: urgencyFactor(input.hoursSinceEvent, input.tauHours, inHazard, cfg),
      demand: demandFactor(c.otherWants, cfg),
      supply: supplyFactor(c.activeContributors, cfg),
    };
    const raw = rate.baseCents * f.scarcity * f.urgency * f.demand * f.supply * pace;
    return { c, f, raw, price: Math.round(clamp(raw, rate.floorCents, rate.ceilingCents)) };
  });

  const remainingCents = remainingAllocation(input.pacing);
  const need = (c: CellMarket) => Math.max(0, c.target - c.accepted);
  const expected = (prices: number[]) =>
    pre.reduce((sum, p, i) => (p.c.pausedReason === null ? sum + need(p.c) * (prices[i] ?? 0) * cfg.maxQualityMultiplier : sum), 0);
  let prices = pre.map((p) => p.price);
  let fit = 1;
  const before = expected(prices);
  if (input.pacing.allocationCents > 0 && before > remainingCents) {
    // Largest scale k whose floored prices fit (cost is monotonic in k; cells pinned at the floor
    // don't shrink, so a single proportional scale would overshoot).
    const scaled = (k: number) => pre.map((p) => Math.max(rate.floorCents, Math.floor(p.price * k)));
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (expected(scaled(mid)) <= remainingCents) lo = mid;
      else hi = mid;
    }
    fit = lo;
    prices = scaled(lo);
  }

  const cells: PricedCell[] = pre.map((p, i) => {
    const price = prices[i] ?? rate.floorCents;
    const factors: CellFactors = { ...p.f, pacing: round2(pace * fit) };
    const paused = p.c.pausedReason !== null;
    return {
      cell: p.c.cell,
      accepted: p.c.accepted,
      target: p.c.target,
      price_cents: price,
      surge: rate.baseCents > 0 ? round2(price / rate.baseCents) : 1,
      paused,
      paused_reason: p.c.pausedReason,
      factors,
      price_reasons: priceReasons(factors, {
        paused,
        atCeiling: price >= rate.ceilingCents && p.raw > rate.ceilingCents,
        atFloor: price <= rate.floorCents,
        covered: p.c.accepted >= p.c.target,
      }),
    };
  });
  return { cells, fit, expectedPayoutCents: Math.round(expected(prices)), remainingCents };
}

/** Worst-case cost of honouring a quote (best quality multiplier), for session budget checks. */
export function worstCaseCents(quoteCents: number, cfg: PricingConfig = PRICING): number {
  return Math.ceil(quoteCents * cfg.maxQualityMultiplier);
}

/** Strips the engine's internal factors before a price leaves the server. */
export function publicCell(c: PricedCell): CellPrice {
  const { factors: _f, ...rest } = c;
  void _f;
  return rest;
}
