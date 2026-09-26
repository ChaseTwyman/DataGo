import { Uuid } from "@groundtruth/shared";
import { json, notFound, route, type IdParams } from "@/lib/api/http";
import { getDb } from "@/lib/db";
import { sponsorImpact } from "@/lib/grokbot/impact";
import { parsePeriod } from "@/lib/grokbot/period";
import { clientIp, enforceRateLimit, LIMITS } from "@/lib/rateLimit";
import { assertGrokbotEnabled } from "@/lib/grokbot/http";

/**
 * Public (no login) sponsor impact: aggregate counts and money only. No user ids, no coordinates or
 * cell ids, no photos. Never calls the model (reuses an admin-generated narrative for the same
 * figures, else the template). Inactive sponsors and sponsors with no money in are 404.
 */
export const GET = route<IdParams>(async (req, { params }) => {
  assertGrokbotEnabled();
  const id = Uuid.parse((await params).id);
  const period = parsePeriod(req);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.publicImpact, clientIp(req));
  const r = await sponsorImpact(db, id, period, { audience: "public" });
  if (!r) throw notFound("Sponsor not found");
  return json(r, { headers: { "cache-control": "public, max-age=300" } });
});
