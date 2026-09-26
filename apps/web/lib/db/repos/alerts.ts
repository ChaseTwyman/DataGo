import type { AlertGeometry, NwsAlert } from "../../context/nws";
import { json, toIsoOrNull, type Db } from "../types";

export async function upsertAlerts(db: Db, alerts: NwsAlert[]): Promise<void> {
  for (const a of alerts) {
    await db.query(
      `insert into public.weather_alerts (id, event, severity, headline, geometry, onset, expires, fetched_at)
       values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz, now())
       on conflict (id) do update set event = excluded.event, severity = excluded.severity, headline = excluded.headline,
         geometry = excluded.geometry, onset = excluded.onset, expires = excluded.expires, fetched_at = now()`,
      [a.id, a.event, a.severity, a.headline, a.geometry ? json(a.geometry) : null, a.onset, a.expires],
    );
  }
}

/** Cached alerts with a geometry that have not expired (manually inserted demo hazards included). */
export async function activeGeometryAlerts(db: Db, nowIso: string): Promise<NwsAlert[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select id, event, severity, headline, geometry, onset, expires from public.weather_alerts
      where geometry is not null and (expires is null or expires > $1::timestamptz)`,
    [nowIso],
  );
  return rows.map((r) => ({
    id: String(r.id),
    event: String(r.event),
    severity: (r.severity as string | null) ?? null,
    headline: (r.headline as string | null) ?? null,
    geometry: r.geometry as AlertGeometry,
    onset: toIsoOrNull(r.onset),
    expires: toIsoOrNull(r.expires),
  }));
}
