/** Human-readable descriptions of pool buckets and request pacing. */
import type { ContributionRow } from "../db/repos/funding";

export function earmarkLabel(
  c: Pick<ContributionRow, "protocol_slug" | "region_center_lat" | "region_center_lng" | "region_radius_m" | "region_polygon" | "bounty_id"> | null,
): string {
  if (!c) return "General pool";
  const parts: string[] = [];
  if (c.bounty_id) parts.push("This request only");
  if (c.protocol_slug) parts.push(`Protocol ${c.protocol_slug}`);
  if (c.region_center_lat !== null && c.region_center_lng !== null && c.region_radius_m !== null) {
    const r = c.region_radius_m >= 1000 ? `${(c.region_radius_m / 1000).toFixed(1)} km` : `${Math.round(c.region_radius_m)} m`;
    parts.push(`${r} around ${c.region_center_lat.toFixed(3)}, ${c.region_center_lng.toFixed(3)}`);
  }
  if (c.region_polygon) parts.push("Custom region");
  return parts.length ? parts.join(" · ") : "General pool";
}

/** "ahead" = spending faster than the clock, "behind" = under-spending. */
export function paceLabel(allocation: number, spentAndCommitted: number, startsAt: string, endsAt: string, now: Date): string {
  if (allocation <= 0) return "unfunded";
  const total = Date.parse(endsAt) - Date.parse(startsAt);
  const elapsed = total > 0 ? Math.min(1, Math.max(0, (now.getTime() - Date.parse(startsAt)) / total)) : 1;
  const used = Math.min(1, spentAndCommitted / allocation);
  if (used > elapsed + 0.15) return "ahead";
  if (used < elapsed - 0.25) return "behind";
  return "on_track";
}
