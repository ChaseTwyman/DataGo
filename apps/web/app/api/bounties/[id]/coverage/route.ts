import { Uuid, type CoverageResponse } from "@groundtruth/shared";
import { loadVisibleBounty } from "@/lib/api/bountyAccess";
import { json, route, type IdParams } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { loadCoverage } from "@/lib/coverage";
import { getDb } from "@/lib/db";

/** Cells with accepted counts, live price, surge, and hazard pause (PRD §10). */
export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const db = await getDb();
  const { bounty, protocol } = await loadVisibleBounty(db, user, id);
  const now = new Date();
  const body: CoverageResponse = {
    bounty_id: bounty.id,
    cells: await loadCoverage(db, bounty, protocol.definition, now),
    computed_at: now.toISOString(),
  };
  return json(body);
});
