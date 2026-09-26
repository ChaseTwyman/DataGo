import { describe, expect, it } from "vitest";
import {
  computePrice,
  formatCents,
  formatSurge,
  isHotSurge,
  lockQuote,
  payoutCents,
  payoutMultiplier,
  scarcityFactor,
  urgencyFactor,
} from "../src/pricing";

describe("computePrice — PRD §10 worked example (base $2, max $10, target 5, tau 3h)", () => {
  it("empty cell 30 min after event start caps at $10.00 (x5.0)", () => {
    const r = computePrice({
      baseCents: 200,
      maxCents: 1000,
      acceptedInCell: 0,
      targetPerCell: 5,
      hoursSinceEventStart: 0.5,
      tauHours: 3,
    });
    // uncapped 2 x 3.0 x 1.85 = $11.08
    expect(200 * r.scarcity * r.urgency).toBeCloseTo(1107.7, 0);
    expect(r.priceCents).toBe(1000);
    expect(formatCents(r.priceCents)).toBe("$10.00");
    expect(formatSurge(r.surge)).toBe("×5.0");
  });

  it("4 of 5 filled, 2 h after start = $4.24 (x2.1)", () => {
    const r = computePrice({
      baseCents: 200,
      maxCents: 1000,
      acceptedInCell: 4,
      targetPerCell: 5,
      hoursSinceEventStart: 2,
      tauHours: 3,
    });
    expect(r.scarcity).toBeCloseTo(1.4, 10);
    expect(r.urgency).toBeCloseTo(1.513, 3);
    expect(formatCents(r.priceCents)).toBe("$4.24");
    expect(formatSurge(r.surge)).toBe("×2.1");
  });
});

describe("pricing factors", () => {
  it("scarcity is 3 when empty, 1 when full or overfilled", () => {
    expect(scarcityFactor(0, 5)).toBe(3);
    expect(scarcityFactor(5, 5)).toBe(1);
    expect(scarcityFactor(9, 5)).toBe(1);
  });
  it("urgency is 1 without an event, 2 at event start, decays", () => {
    expect(urgencyFactor(null, 3)).toBe(1);
    expect(urgencyFactor(0, 3)).toBe(2);
    expect(urgencyFactor(-1, 3)).toBe(2);
    expect(urgencyFactor(30, 3)).toBeLessThan(1.001);
  });
  it("urgency never applies inside a hazard", () => {
    const r = computePrice({
      baseCents: 200,
      maxCents: 1000,
      acceptedInCell: 5,
      targetPerCell: 5,
      hoursSinceEventStart: 0,
      tauHours: 3,
      inHazard: true,
    });
    expect(r.urgency).toBe(1);
    expect(r.priceCents).toBe(200);
  });
  it("never goes below base", () => {
    const r = computePrice({
      baseCents: 200,
      maxCents: 1000,
      acceptedInCell: 5,
      targetPerCell: 5,
      hoursSinceEventStart: null,
      tauHours: 3,
      priority: 0.2,
    });
    expect(r.priceCents).toBe(200);
  });
  it("priority multiplies", () => {
    const r = computePrice({
      baseCents: 100,
      maxCents: 1000,
      acceptedInCell: 5,
      targetPerCell: 5,
      hoursSinceEventStart: null,
      tauHours: 3,
      priority: 2,
    });
    expect(r.priceCents).toBe(200);
    expect(isHotSurge(r.surge)).toBe(true);
  });
});

describe("quotes and payouts", () => {
  it("locks a quote for 15 minutes", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    expect(lockQuote(424, now)).toEqual({ priceCents: 424, expiresAt: "2026-09-26T12:15:00.000Z" });
  });
  it("multiplier spans 0.8 to 1.2", () => {
    expect(payoutMultiplier(0)).toBe(0.8);
    expect(payoutMultiplier(1)).toBe(1.2);
    expect(payoutMultiplier(0.5)).toBe(1);
    expect(payoutMultiplier(7)).toBe(1.2);
  });
  it("payout = quote x multiplier, rounded to cents", () => {
    expect(payoutCents(1000, 1.2)).toBe(1200);
    expect(payoutCents(424, 1.08)).toBe(458);
  });
});
