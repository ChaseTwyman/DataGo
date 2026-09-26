/**
 * Hazard pause (PRD §10 safety overrides): cells intersecting NWS alerts with severity Extreme or
 * an event in HAZARD_PAUSE_EVENTS are paused — price shown, capture disabled, urgency never applies.
 * Alerts at the bounty center are fetched from NWS (cached 10 min in memory, persisted to
 * weather_alerts). A point alert without geometry (zone-based) pauses every cell of the bounty.
 */
import { cellCenter } from "@groundtruth/shared";
import { activeAlertsAt, pointInAlert, type NwsAlert } from "./context/nws";
import type { Db } from "./db";
import { activeGeometryAlerts, upsertAlerts } from "./db/repos/alerts";
import type { BountyRow } from "./db/repos/bounties";
import { hazardPauseEvents, isOffline } from "./env";

const TTL_MS = 10 * 60_000;
const g = globalThis as typeof globalThis & { __gtAlertCache?: Map<string, { at: number; alerts: NwsAlert[] }> };
const pointCache = (g.__gtAlertCache ??= new Map());

export function clearHazardCache(): void {
  pointCache.clear();
}

export function isPausingAlert(a: Pick<NwsAlert, "event" | "severity">, events = hazardPauseEvents()): boolean {
  if (a.severity === "Extreme") return true;
  const ev = a.event.toLowerCase();
  return events.some((e) => e.toLowerCase() === ev);
}

async function alertsAtPoint(db: Db, lat: number, lng: number, now: number): Promise<NwsAlert[]> {
  if (isOffline()) return [];
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = pointCache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.alerts;
  try {
    const alerts = await activeAlertsAt(lat, lng);
    pointCache.set(key, { at: now, alerts });
    if (alerts.length > 0) await upsertAlerts(db, alerts);
    return alerts;
  } catch (err) {
    // NWS is US-only and sometimes slow; a failed lookup never blocks captures, but is logged.
    console.warn("[hazards] NWS lookup failed:", err instanceof Error ? err.message : err);
    pointCache.set(key, { at: now, alerts: [] });
    return [];
  }
}

/** cell → human-readable pause reason, for every paused cell of the bounty. */
export async function pausedCells(db: Db, bounty: BountyRow, now = new Date()): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const atPoint = (await alertsAtPoint(db, bounty.center_lat, bounty.center_lng, now.getTime())).filter((a) => isPausingAlert(a));
  const cached = (await activeGeometryAlerts(db, now.toISOString())).filter((a) => isPausingAlert(a));
  const seen = new Set<string>();
  for (const a of [...atPoint, ...cached]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const reason = `${a.event}${a.headline ? `: ${a.headline}` : ""}`;
    for (const cell of bounty.cells) {
      if (out.has(cell)) continue;
      if (!a.geometry) {
        if (atPoint.includes(a)) out.set(cell, reason);
        continue;
      }
      const c = cellCenter(cell);
      if (pointInAlert(c.lat, c.lng, a.geometry)) out.set(cell, reason);
    }
  }
  return out;
}
