import { Uuid } from "@groundtruth/shared";
import { json, mockVariantOf, notFound, route, type IdParams } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertGrokbotEnabled, wantsRefresh } from "@/lib/grokbot/http";
import { sponsorImpact } from "@/lib/grokbot/impact";
import { parsePeriod } from "@/lib/grokbot/period";

export const maxDuration = 30;

/**
 * Sponsor impact report for admins (aggregates only; model narrative cached per figures).
 * Optional ?from&to ISO datetimes (no from = all time). `?refresh=1` regenerates (own rate limit).
 */
export const GET = route<IdParams>(async (req, { params }) => {
  assertGrokbotEnabled();
  const id = Uuid.parse((await params).id);
  const user = await requireAdmin(req);
  const period = parsePeriod(req);
  const db = await getDb();
  const refresh = await wantsRefresh(req, db, user.id);
  const r = await sponsorImpact(db, id, period, { audience: "admin", mockError: mockVariantOf(req) === "error", refresh });
  if (!r) throw notFound("Sponsor not found");
  return json(r, { headers: { "cache-control": "no-store" } });
});
