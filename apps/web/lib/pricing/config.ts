/**
 * GroundTruth pricing configuration (server-only). Every weight of the pricing engine lives here, so
 * tuning the market is one reviewed diff. Prices are platform-owned: researchers and contributors
 * never set them (PRD §10, sponsor-pool revision).
 *
 * price(cell) = clamp(base × scarcity × urgency × demand × supply × pacing, floor, ceiling)
 * then fitted to the request's remaining allocation (see engine.ts `priceCells`).
 */
import type { Protocol } from "@groundtruth/shared";

export interface ProtocolRateOverride {
  /** Base rate (the price of an average reading, before surge). */
  baseCents?: number;
  /** Never pay less than this per reading (defaults to the base rate). */
  floorCents?: number;
  /** Never pay more than this per reading (defaults to base × ceilingMultiple). */
  ceilingCents?: number;
  /** Travel effort multiplier for protocols that need a trip (defaults to 1). */
  travel?: number;
}

export const PRICING = {
  /** Base rate of a trivial, safe, one-photo protocol before effort multipliers. */
  baseRateCents: 150,
  /** Base rates are rounded to this many cents. */
  roundToCents: 25,
  /** Effort: capture difficulty. Each extra burst frame / required element / field question adds this share. */
  effort: { perExtraFrame: 0.05, perRequiredElement: 0.04, perFieldQuestion: 0.03 },
  /** Effort: safety level of the protocol (being near floodwater is worth more than a label photo). */
  safety: { low: 1, normal: 1.15, elevated: 1.35, high: 1.6 } as Record<Protocol["safety"]["level"], number>,
  /** Default ceiling = base × this. */
  ceilingMultiple: 5,
  /** Per-protocol overrides by slug. The flood protocol keeps the prices the demo was built around. */
  protocols: {
    "street-flood-depth": { baseCents: 200, ceilingCents: 1000 },
  } as Record<string, ProtocolRateOverride>,

  /** Scarcity: 1 + alpha × (share of the cell's target still missing). Empty cell → ×3. */
  scarcity: { alpha: 2 },
  /** Urgency: 1 + beta × exp(−hours since event / tau). Never applied in hazard-paused cells. */
  urgency: { beta: 1 },
  /**
   * Demand: 1 + gamma × min(maxExtra, other wants). "Other wants" = other funded requests (from other
   * researchers, counted once per researcher, only with at least minRemainingCents left) for the same
   * protocol covering the cell + sponsor earmarks with money left that match the protocol/region.
   * A researcher's own overlapping requests never count.
   */
  demand: { gamma: 0.1, maxExtra: 4, minRemainingCents: 5_000 },
  /**
   * Supply: inverse of recent contributor activity near the cell (distinct contributors who opened a
   * capture session in the cell or its ring-1 neighbours in the last `windowHours`).
   * factor = clamp(1 + maxBoost − perActive × active, min, 1 + maxBoost): nobody around → ×1.15.
   */
  supply: { windowHours: 6, ringK: 1, maxBoost: 0.15, perActive: 0.1, min: 0.85 },
  /**
   * Pacing: (share of allocation left ÷ share of time left) ^ kappa, clamped. Burning faster than the
   * clock → below 1 (slows spend); under-spending → above 1 (boost to finish on time). A second,
   * hard step ("fit") then scales prices so the expected cost of every remaining reading at the
   * best quality multiplier stays within the remaining allocation.
   */
  pacing: { kappa: 0.5, min: 0.7, max: 1.25 },
  /** Highest payout multiplier (packages/shared payoutMultiplier): the worst case per quote. */
  maxQualityMultiplier: 1.2,
} as const;

export type PricingConfig = typeof PRICING;
