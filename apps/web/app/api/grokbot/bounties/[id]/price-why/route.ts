import { Lat, Lng, Uuid } from "@groundtruth/shared";
import { z } from "zod";
import { json, mockVariantOf, parseQuery, route, type IdParams } from "@/lib/api/http";
import { loadVisibleBounty } from "@/lib/api/bountyAccess";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { priceWhy } from "@/lib/grokbot/bounty";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const maxDuration = 30;

const Query = z.object({ lat: z.coerce.number().pipe(Lat), lng: z.coerce.number().pipe(Lng) });

/**
 * Contributor "why this price?" for the caller's location. Grounded only in the price, surge and
 * price_reasons the phone already shows plus public facts; never the engine's factors or weights.
 */
export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const q = parseQuery(req, Query);
  const user = await requireUser(req);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.grokbot, user.id);
  const { bounty, protocol } = await loadVisibleBounty(db, user, id);
  return json(await priceWhy(db, bounty, protocol, q.lat, q.lng, { mockError: mockVariantOf(req) === "error" }), { headers: { "cache-control": "no-store" } });
});
