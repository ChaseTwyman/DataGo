import {
  cellForPoint,
  haversineM,
  NearbyQuerySchema,
  type BountySummary,
  type NearbyResponse,
} from "@groundtruth/shared";
import { json, originOf, parseQuery, route } from "@/lib/api/http";
import { mediaUrl } from "@/lib/api/views";
import { requireUser } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { autoRefreshMatches } from "@/lib/grokbot/match";
import { loadPricing } from "@/lib/coverage";
import { getDb } from "@/lib/db";
import { listActiveBounties } from "@/lib/db/repos/bounties";
import { matchScores } from "@/lib/db/repos/match";
import { getProtocol, type ProtocolRow } from "@/lib/db/repos/protocols";

/** Active bounties near the caller with live price, surge, distance, match, and paused cells (PRD §16). */
export const GET = route(async (req) => {
  const q = parseQuery(req, NearbyQuerySchema);
  const user = await requireUser(req);
  const db = await getDb();
  const now = new Date();
  const origin = originOf(req);
  const [bounties, matches] = await Promise.all([listActiveBounties(db, now), matchScores(db, user.id)]);
  const protocols = new Map<string, ProtocolRow | null>();
  const userCell = cellForPoint(q.lat, q.lng);
  const out: BountySummary[] = [];

  for (const b of bounties) {
    const distance = haversineM(q.lat, q.lng, b.center_lat, b.center_lng);
    if (distance > q.radius_km * 1000 + b.radius_m) continue;
    if (!protocols.has(b.protocol_id)) protocols.set(b.protocol_id, await getProtocol(db, b.protocol_id));
    const p = protocols.get(b.protocol_id);
    if (!p) continue;
    const pricing = await loadPricing(db, b, p.definition, now, { viewerId: user.id });
    const coverage = pricing.cells;
    const open = coverage.filter((c) => !c.paused);
    const here = coverage.find((c) => c.cell === userCell);
    const best = [...open].sort((a, c) => c.price_cents - a.price_cents)[0];
    const pick = here ?? best ?? coverage[0];
    const price = pick?.price_cents ?? pricing.rate.baseCents;
    const m = matches.get(b.id);
    const proximity = Math.max(0, 1 - Math.max(0, distance - b.radius_m) / (q.radius_km * 1000));
    const value = pricing.rate.ceilingCents > 0 ? price / pricing.rate.ceilingCents : 0;
    const match = 0.4 * proximity + 0.3 * (m?.skill_fit ?? 0.5) + 0.2 * value + 0.1 * user.trustScore;
    out.push({
      id: b.id,
      title: b.title,
      summary: b.summary,
      protocol_slug: p.slug,
      protocol_name: p.name,
      safety_level: p.definition.safety.level,
      center_lat: b.center_lat,
      center_lng: b.center_lng,
      radius_m: b.radius_m,
      distance_m: Math.round(distance),
      price_cents: price,
      surge: pick?.surge ?? 1,
      max_surge: Math.max(1, ...open.map((c) => c.surge)),
      ends_at: b.ends_at,
      cells_total: coverage.length,
      cells_needed: coverage.filter((c) => c.accepted < c.target).length,
      paused_cells: coverage.length - open.length,
      match_score: Math.round(Math.min(1, Math.max(0, match)) * 1000) / 1000,
      match_reason: m?.reason ?? null,
      // Allocation left after locked quotes (worst case): what can still be promised.
      budget_remaining_cents: pricing.remainingCents,
      example_image_url: await mediaUrl(p.example_image_path, origin, 24 * 3600),
      sponsor_name: b.sponsor_name,
      sponsor_url: b.sponsor_url,
      price_reasons: pick?.price_reasons ?? [],
    });
  }
  out.sort((a, b) => a.distance_m - b.distance_m);
  // Grokbot For-you: fill/refresh match_cache after responding (stale rows only, rate-limited per user).
  runInBackground(() => autoRefreshMatches(db, user.id));
  const body: NearbyResponse = { bounties: out };
  return json(body);
});
