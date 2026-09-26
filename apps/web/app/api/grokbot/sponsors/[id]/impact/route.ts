import { Uuid } from "@groundtruth/shared";
import { json, mockVariantOf, notFound, route, type IdParams } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sponsorImpact } from "@/lib/grokbot/impact";
import { parsePeriod } from "@/lib/grokbot/period";

export const maxDuration = 30;

/** Sponsor impact report for admins (aggregates only; model narrative, cached per figures). */
export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  await requireAdmin(req);
  const period = parsePeriod(req);
  const r = await sponsorImpact(await getDb(), id, period, { audience: "admin", mockError: mockVariantOf(req) === "error" });
  if (!r) throw notFound("Sponsor not found");
  return json(r, { headers: { "cache-control": "no-store" } });
});
