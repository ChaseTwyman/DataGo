/** Pure helpers for the bounty feed (unit-tested). */
import type { BountySummary } from "@groundtruth/shared";

/** "For you" order: match score first (missing scores last), then price, then distance. */
export function sortForYou(bounties: BountySummary[]): BountySummary[] {
  return [...bounties].sort((a, b) => {
    const ma = a.match_score ?? -1;
    const mb = b.match_score ?? -1;
    if (mb !== ma) return mb - ma;
    if (b.price_cents !== a.price_cents) return b.price_cents - a.price_cents;
    return a.distance_m - b.distance_m;
  });
}

export function timeLeft(endsAt: string, now = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return "ended";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min left`;
  return `${Math.floor(h / 24)} days left`;
}

export function distanceLabel(m: number): string {
  if (m < 50) return "You're here";
  return m < 1000 ? `${Math.round(m / 10) * 10} m away` : `${(m / 1000).toFixed(1)} km away`;
}

export function safetyLabel(level: string): { text: string; tone: "ok" | "warn" | "bad" } {
  switch (level) {
    case "low":
    case "normal":
      return { text: `Safety: ${level}`, tone: "ok" };
    case "elevated":
      return { text: "Safety: elevated", tone: "warn" };
    default:
      return { text: `Safety: ${level}`, tone: "bad" };
  }
}

/** Count-up easing for money animations: ease-out cubic, integer cents. */
export function countUpValue(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return Math.round(from + (to - from) * (1 - (1 - k) ** 3));
}
