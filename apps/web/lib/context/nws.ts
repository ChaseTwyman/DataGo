/** NWS active alerts at a point (US only; a descriptive User-Agent is required). PRD Appendix B. */
import { nwsUserAgent } from "../env";
import { fetchJson } from "./fetcher";

export type AlertGeometry =
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "MultiPolygon"; coordinates: [number, number][][][] };

export interface NwsAlert {
  id: string;
  event: string;
  severity: string | null;
  headline: string | null;
  geometry: AlertGeometry | null;
  onset: string | null;
  expires: string | null;
}

interface NwsFeature {
  id?: string;
  geometry?: AlertGeometry | null;
  properties?: { id?: string; event?: string; severity?: string; headline?: string; onset?: string; expires?: string };
}

export function parseNwsAlerts(body: { features?: NwsFeature[] }): NwsAlert[] {
  return (body.features ?? []).flatMap((f) => {
    const p = f.properties ?? {};
    const id = p.id ?? f.id;
    if (!id || !p.event) return [];
    const geometry = f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") ? f.geometry : null;
    return [{ id, event: p.event, severity: p.severity ?? null, headline: p.headline ?? null, geometry, onset: p.onset ?? null, expires: p.expires ?? null }];
  });
}

export async function activeAlertsAt(lat: number, lng: number): Promise<NwsAlert[]> {
  const body = await fetchJson<{ features?: NwsFeature[] }>(
    `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`,
    { headers: { "User-Agent": nwsUserAgent(), Accept: "application/geo+json" }, timeoutMs: 5000 },
  );
  return parseNwsAlerts(body);
}

/** Ray casting over the outer ring(s). GeoJSON order [lng, lat]. */
export function pointInAlert(lat: number, lng: number, g: AlertGeometry): boolean {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some((poly) => {
    const ring = poly[0] ?? [];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
