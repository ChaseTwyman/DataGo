import {
  cellCenter,
  haversineM,
  missionViewState,
  NearbyMissionsQuerySchema,
  type MissionSummary,
  type NearbyMissionsResponse,
} from "@groundtruth/shared";
import { json, parseQuery, route } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { loadPricing } from "@/lib/coverage";
import { getDb } from "@/lib/db";
import { listActiveBounties } from "@/lib/db/repos/bounties";
import { getProtocol, type ProtocolRow } from "@/lib/db/repos/protocols";
import { expireMissions, openMissions } from "@/lib/missions/repo";

const MAX = 20;

/**
 * Revisit missions near the caller (open or upcoming; For you + map). The caller's own chains come
 * first ("same spot"), then soonest due. Prices come from the platform engine for this caller, so a
 * mission reserved for its original contributor shows no revisit boost to anyone else. Never exposes
 * who the original contributor is or where exactly the reading was taken (cell centre only).
 */
export const GET = route(async (req) => {
  const q = parseQuery(req, NearbyMissionsQuerySchema);
  const user = await requireUser(req);
  const db = await getDb();
  const now = new Date();
  await expireMissions(db, now);
  const bounties = (await listActiveBounties(db, now)).filter(
    (b) => haversineM(q.lat, q.lng, b.center_lat, b.center_lng) <= q.radius_km * 1000 + b.radius_m,
  );
  if (bounties.length === 0) return json<NearbyMissionsResponse>({ missions: [] });
  const byId = new Map(bounties.map((b) => [b.id, b]));
  const missions = await openMissions(db, { bountyIds: [...byId.keys()], now });

  const protocols = new Map<string, ProtocolRow | null>();
  const prices = new Map<string, Map<string, { price: number; reasons: string[] }>>();
  const out: MissionSummary[] = [];
  for (const m of missions) {
    const b = byId.get(m.bounty_id);
    if (!b) continue;
    if (!protocols.has(b.protocol_id)) protocols.set(b.protocol_id, await getProtocol(db, b.protocol_id));
    const p = protocols.get(b.protocol_id);
    if (!p) continue;
    if (!prices.has(b.id)) {
      const pricing = await loadPricing(db, b, p.definition, now, { viewerId: user.id });
      prices.set(b.id, new Map(pricing.cells.map((c) => [c.cell, { price: c.price_cents, reasons: c.paused ? ["Paused for safety"] : c.price_reasons }])));
    }
    const c = cellCenter(m.cell);
    const v = missionViewState(m, user.id, now);
    const price = prices.get(b.id)?.get(m.cell) ?? null;
    const distance = haversineM(q.lat, q.lng, c.lat, c.lng);
    if (distance > q.radius_km * 1000) continue;
    out.push({
      id: m.id,
      bounty_id: b.id,
      bounty_title: b.title,
      protocol_name: p.name,
      cell: m.cell,
      lat: c.lat,
      lng: c.lng,
      sequence: m.sequence,
      interval_min: m.interval_min,
      due_at: m.due_at,
      opens_at: m.opens_at,
      closes_at: m.closes_at,
      dibs_until: m.dibs_until,
      status: m.status,
      yours: v.yours,
      reserved: v.reserved,
      price_cents: price?.price ?? null,
      price_reasons: price?.reasons ?? [],
      distance_m: Math.round(distance),
    });
  }
  out.sort((a, b) => Number(b.yours) - Number(a.yours) || a.due_at.localeCompare(b.due_at) || (a.distance_m ?? 0) - (b.distance_m ?? 0));
  return json<NearbyMissionsResponse>({ missions: out.slice(0, MAX) });
});
