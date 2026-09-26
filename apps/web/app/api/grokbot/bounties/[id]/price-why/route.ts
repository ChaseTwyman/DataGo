import { Lat, Lng, Uuid } from "@groundtruth/shared";
import { z } from "zod";
import { badRequest, json, mockVariantOf, parseQuery, route, type IdParams } from "@/lib/api/http";
import { loadVisibleBounty } from "@/lib/api/bountyAccess";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { priceWhy } from "@/lib/grokbot/bounty";
import { assertGrokbotEnabled } from "@/lib/grokbot/http";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const maxDuration = 30;

const Query = z.object({ lat: z.coerce.number().pipe(Lat).optional(), lng: z.coerce.number().pipe(Lng).optional() });

/**
 * Contributor "why this price?" at the caller's location (?lat&lng), or at the bounty's best open
 * cell when no location is given. Grounded only in the price, surge and price_reasons the phone
 * already shows plus public facts; never the engine's factors or weights.
 */
export const GET = route<IdParams>(async (req, { params }) => {
  assertGrokbotEnabled();
  const id = Uuid.parse((await params).id);
  const q = parseQuery(req, Query);
  if ((q.lat === undefined) !== (q.lng === undefined)) throw badRequest("Pass both lat and lng, or neither");
  const user = await requireUser(req);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.grokbot, user.id);
  const { bounty, protocol } = await loadVisibleBounty(db, user, id);
  const at = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
  return json(await priceWhy(db, bounty, protocol, at, { mockError: mockVariantOf(req) === "error" }), { headers: { "cache-control": "no-store" } });
});
