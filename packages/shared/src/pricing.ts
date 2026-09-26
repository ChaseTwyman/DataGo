/** Pricing engine, PRD §10. All money is integer cents. */

export const SCARCITY_ALPHA = 2;
export const URGENCY_BETA = 1;
export const QUOTE_TTL_MIN = 15;

export interface PriceInput {
  baseCents: number;
  maxCents: number;
  acceptedInCell: number;
  targetPerCell: number;
  /** Hours since the triggering event started; null when the bounty has no event. */
  hoursSinceEventStart: number | null;
  tauHours: number;
  priority?: number;
  /** Cell intersects a hazard polygon: urgency never applies (PRD §10 safety overrides). */
  inHazard?: boolean;
}

export interface PriceResult {
  priceCents: number;
  /** price / base, rounded to 2 decimals. */
  surge: number;
  scarcity: number;
  urgency: number;
  priority: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function scarcityFactor(acceptedInCell: number, targetPerCell: number): number {
  if (targetPerCell <= 0) return 1;
  return 1 + SCARCITY_ALPHA * Math.max(0, 1 - acceptedInCell / targetPerCell);
}

export function urgencyFactor(hoursSinceEventStart: number | null, tauHours: number): number {
  if (hoursSinceEventStart === null || tauHours <= 0) return 1;
  return 1 + URGENCY_BETA * Math.exp(-Math.max(0, hoursSinceEventStart) / tauHours);
}

export function computePrice(input: PriceInput): PriceResult {
  const priority = input.priority ?? 1;
  const scarcity = scarcityFactor(input.acceptedInCell, input.targetPerCell);
  const urgency = input.inHazard ? 1 : urgencyFactor(input.hoursSinceEventStart, input.tauHours);
  const raw = input.baseCents * scarcity * urgency * priority;
  const maxCents = Math.max(input.baseCents, input.maxCents);
  const priceCents = Math.round(clamp(raw, input.baseCents, maxCents));
  const surge = input.baseCents > 0 ? Math.round((priceCents / input.baseCents) * 100) / 100 : 1;
  return { priceCents, surge, scarcity, urgency, priority };
}

export function hoursBetween(from: Date | string, to: Date | string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

export interface LockedQuote {
  priceCents: number;
  expiresAt: string;
}

export function lockQuote(priceCents: number, now: Date = new Date()): LockedQuote {
  return { priceCents, expiresAt: new Date(now.getTime() + QUOTE_TTL_MIN * 60_000).toISOString() };
}

/** Quality multiplier 0.8–1.2, linear in protocol score (PRD §10 payout). */
export function payoutMultiplier(protocolScore: number): number {
  return Math.round((0.8 + 0.4 * clamp(protocolScore, 0, 1)) * 100) / 100;
}

export function payoutCents(quoteCents: number, multiplier: number): number {
  return Math.round(quoteCents * multiplier);
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatSurge(surge: number): string {
  return `×${surge.toFixed(1)}`;
}

/** Surge badge turns amber at ×2 or more (BUILD_PROMPT §8). */
export const isHotSurge = (surge: number): boolean => surge >= 2;
