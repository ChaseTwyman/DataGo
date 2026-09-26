import { describe, expect, it } from "vitest";
import { payoutCents, payoutMultiplier, streetFloodDepth, type Protocol } from "@groundtruth/shared";
import { PRICING } from "./config";
import {
  demandFactor,
  effortMultiplier,
  pacingFactor,
  priceCells,
  priceReasons,
  protocolRate,
  publicCell,
  remainingAllocation,
  scarcityFactor,
  supplyFactor,
  urgencyFactor,
  worstCaseCents,
  type CellMarket,
  type PacingInput,
} from "./engine";

const T0 = new Date("2026-09-26T12:00:00Z");
const iso = (h: number) => new Date(T0.getTime() + h * 3_600_000).toISOString();
const pacing = (over: Partial<PacingInput> = {}): PacingInput => ({
  allocationCents: 1_000_000,
  spentCents: 0,
  committedCents: 0,
  startsAt: iso(0),
  endsAt: iso(24),
  now: T0,
  ...over,
});
const cell = (over: Partial<CellMarket> = {}): CellMarket => ({
  cell: "c0",
  accepted: 0,
  target: 5,
  pausedReason: null,
  otherWants: 0,
  activeContributors: 1, // supply neutral-ish (1.05)
  ...over,
});
const flood = protocolRate(streetFloodDepth);

describe("protocol base rate", () => {
  it("uses the per-protocol override for the flood protocol ($2 base, $10 ceiling)", () => {
    expect(flood).toEqual({ baseCents: 200, floorCents: 200, ceilingCents: 1000 });
  });

  it("derives a default from effort: harder and less safe protocols pay more", () => {
    const easy: Protocol = {
      ...streetFloodDepth,
      slug: "label-photo",
      safety: { ...streetFloodDepth.safety, level: "low" },
      capture: { ...streetFloodDepth.capture, frames: 1, field_questions: [], required_elements: streetFloodDepth.capture.required_elements.slice(0, 1) },
    };
    const hard: Protocol = { ...easy, slug: "storm-drain", safety: { ...easy.safety, level: "high" }, capture: { ...streetFloodDepth.capture, frames: 5 } };
    const e = protocolRate(easy);
    const h = protocolRate(hard);
    expect(effortMultiplier(hard)).toBeGreaterThan(effortMultiplier(easy));
    expect(h.baseCents).toBeGreaterThan(e.baseCents);
    expect(e.baseCents % PRICING.roundToCents).toBe(0);
    expect(e.floorCents).toBe(e.baseCents);
    expect(e.ceilingCents).toBe(e.baseCents * PRICING.ceilingMultiple);
  });
});

describe("factors", () => {
  it("scarcity: ×3 for an empty cell, ×1 once the target is met", () => {
    expect(scarcityFactor(0, 5)).toBe(3);
    expect(scarcityFactor(4, 5)).toBeCloseTo(1.4);
    expect(scarcityFactor(5, 5)).toBe(1);
    expect(scarcityFactor(9, 5)).toBe(1);
  });

  it("urgency: decays with event age and never applies in a hazard cell", () => {
    expect(urgencyFactor(0, 3, false)).toBe(2);
    expect(urgencyFactor(3, 3, false)).toBeCloseTo(1 + Math.exp(-1));
    expect(urgencyFactor(null, 3, false)).toBe(1);
    expect(urgencyFactor(0, 3, true)).toBe(1);
    expect(urgencyFactor(-2, 3, false)).toBe(1); // event in the future: no urgency (requester-set field)
  });

  it("demand: +10% per other want, capped", () => {
    expect(demandFactor(0)).toBe(1);
    expect(demandFactor(2)).toBeCloseTo(1.2);
    expect(demandFactor(99)).toBeCloseTo(1 + PRICING.demand.gamma * PRICING.demand.maxExtra);
  });

  it("supply: nobody around boosts, a crowd discounts, both clamped", () => {
    expect(supplyFactor(0)).toBeCloseTo(1.15);
    expect(supplyFactor(2)).toBeCloseTo(0.95);
    expect(supplyFactor(50)).toBe(PRICING.supply.min);
  });

  it("pacing: slows spend when burning faster than the clock, boosts when under-spending", () => {
    // half the time left, half the money left → neutral
    expect(pacingFactor(pacing({ spentCents: 500_000, now: new Date(T0.getTime() + 12 * 3_600_000) }))).toBeCloseTo(1);
    // 90% of the money gone with 90% of the time left → slow down (clamped at min)
    expect(pacingFactor(pacing({ spentCents: 900_000, now: new Date(T0.getTime() + 2.4 * 3_600_000) }))).toBe(PRICING.pacing.min);
    // nothing spent, 80% of the time gone → boost (clamped at max)
    expect(pacingFactor(pacing({ now: new Date(T0.getTime() + 19.2 * 3_600_000) }))).toBe(PRICING.pacing.max);
    // committed quotes count as spent
    expect(remainingAllocation({ allocationCents: 1000, spentCents: 300, committedCents: 800 })).toBe(0);
    expect(pacingFactor(pacing({ allocationCents: 0 }))).toBe(1);
  });
});

describe("priceCells", () => {
  it("multiplies the factors and clamps to the protocol floor/ceiling", () => {
    const r = priceCells({ rate: flood, tauHours: 3, hoursSinceEvent: 0.5, cells: [cell()], pacing: pacing() });
    const c = r.cells[0]!;
    expect(c.price_cents).toBe(1000); // 200 × 3 × 1.85 × 1.05 > ceiling
    expect(c.surge).toBe(5);
    expect(c.price_reasons).toContain("Few readings here");
    expect(c.price_reasons).toContain("Event is recent");
    expect(c.price_reasons).toContain("At the maximum price");
    const covered = priceCells({ rate: flood, tauHours: 3, hoursSinceEvent: null, cells: [cell({ accepted: 5, activeContributors: 9 })], pacing: pacing() });
    expect(covered.cells[0]!.price_cents).toBe(200); // 200 × 1 × 1 × 0.85 → floor
    expect(covered.cells[0]!.price_reasons).toContain("Enough readings here already");
  });

  it("hazard cells: paused, and priced without urgency (never an urgency boost toward danger)", () => {
    const r = priceCells({
      rate: flood,
      tauHours: 3,
      hoursSinceEvent: 0,
      cells: [cell({ cell: "safe" }), cell({ cell: "hazard", pausedReason: "Flash Flood Emergency" })],
      pacing: pacing(),
    });
    const [safe, hazard] = r.cells;
    expect(hazard!.paused).toBe(true);
    expect(hazard!.factors.urgency).toBe(1);
    expect(safe!.factors.urgency).toBe(2);
    expect(hazard!.price_reasons[0]).toBe("Paused for safety");
    expect(hazard!.price_reasons).not.toContain("Event is recent");
  });

  it("demand and supply move the price in the expected direction", () => {
    const base = { rate: { baseCents: 100, floorCents: 50, ceilingCents: 10_000 }, tauHours: 3, hoursSinceEvent: null, pacing: pacing() };
    const lo = priceCells({ ...base, cells: [cell({ activeContributors: 5 })] }).cells[0]!;
    const hi = priceCells({ ...base, cells: [cell({ otherWants: 3, activeContributors: 0 })] }).cells[0]!;
    expect(hi.price_cents).toBeGreaterThan(lo.price_cents);
    expect(hi.price_reasons).toEqual(expect.arrayContaining(["High demand", "Few contributors nearby"]));
    expect(lo.price_reasons).toContain("Many contributors nearby");
  });

  it("fits prices to the remaining allocation: expected payout never exceeds it when the floor allows", () => {
    const cells = Array.from({ length: 20 }, (_, i) => cell({ cell: `c${i}` }));
    // need = 20 cells × 5 = 100 readings; floor 200 × 1.2 × 100 = 24 000 fits in 40 000
    const r = priceCells({ rate: flood, tauHours: 3, hoursSinceEvent: 0, cells, pacing: pacing({ allocationCents: 40_000 }) });
    expect(r.fit).toBeLessThan(1);
    expect(r.expectedPayoutCents).toBeLessThanOrEqual(40_000);
    expect(r.cells.every((c) => c.price_cents >= flood.floorCents)).toBe(true);
    expect(r.cells[0]!.price_reasons).toContain("Budget is being paced");
  });

  it("publicCell strips the internal factors", () => {
    const r = priceCells({ rate: flood, tauHours: 3, hoursSinceEvent: null, cells: [cell()], pacing: pacing() });
    const pub = publicCell(r.cells[0]!);
    expect(pub).not.toHaveProperty("factors");
    expect(pub.price_reasons?.length).toBeGreaterThan(0);
  });

  it("priceReasons orders the strongest factor first", () => {
    expect(priceReasons({ scarcity: 3, urgency: 1.3, demand: 1, supply: 1, pacing: 1 }, { paused: false, atCeiling: false, atFloor: false, covered: false })[0]).toBe(
      "Few readings here",
    );
  });
});

/**
 * Pacing invariant: simulate a whole request window. Contributors arrive at random cells at random
 * times; each is quoted by the engine with the live state, a session is refused when the remaining
 * allocation (after locked quotes) can't cover the quote at the best quality multiplier (the
 * sessions route's rule), and the payout is quote × a random quality multiplier. The total paid
 * must never exceed the allocation, whatever the arrival pattern.
 */
describe("pacing invariant (simulated window)", () => {
  function simulate(seed: number, allocationCents: number, arrivals: number, cellsN: number) {
    let a = seed >>> 0;
    const rand = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const accepted = new Array<number>(cellsN).fill(0);
    let spent = 0;
    let refused = 0;
    const times = Array.from({ length: arrivals }, () => rand() * 24).sort((x, y) => x - y);
    for (const h of times) {
      const now = new Date(T0.getTime() + h * 3_600_000);
      const cells = accepted.map((n, i) => cell({ cell: `c${i}`, accepted: n, activeContributors: Math.floor(rand() * 4), otherWants: Math.floor(rand() * 3) }));
      const r = priceCells({
        rate: flood,
        tauHours: 3,
        hoursSinceEvent: h,
        cells,
        pacing: pacing({ allocationCents, spentCents: spent, now }),
      });
      if (r.expectedPayoutCents > 0 && r.fit < 1) {
        // whenever the fit could apply without hitting the floor, expected payout is within the allocation
        const floorCost = cells.reduce((s, c) => s + Math.max(0, c.target - c.accepted), 0) * flood.floorCents * PRICING.maxQualityMultiplier;
        if (floorCost <= r.remainingCents) expect(r.expectedPayoutCents).toBeLessThanOrEqual(r.remainingCents);
      }
      const i = Math.floor(rand() * cellsN);
      const quote = r.cells[i]!.price_cents;
      if (r.remainingCents < worstCaseCents(quote)) {
        refused++;
        continue;
      }
      const pay = payoutCents(quote, payoutMultiplier(rand()));
      spent += pay;
      accepted[i] = (accepted[i] ?? 0) + 1;
      expect(spent).toBeLessThanOrEqual(allocationCents);
    }
    return { spent, refused };
  }

  it("never pays more than the allocation (tight, medium and generous allocations)", () => {
    for (const [seed, alloc] of [
      [1, 3_000],
      [2, 20_000],
      [3, 60_000],
      [4, 250_000],
      [5, 9_999],
    ] as const) {
      const { spent } = simulate(seed, alloc, 400, 12);
      expect(spent).toBeLessThanOrEqual(alloc);
    }
  });

  it("a tight allocation is actually spent down (not frozen) and then refuses sessions", () => {
    const { spent, refused } = simulate(7, 5_000, 300, 12);
    expect(spent).toBeGreaterThan(5_000 * 0.7);
    expect(refused).toBeGreaterThan(0);
  });
});
