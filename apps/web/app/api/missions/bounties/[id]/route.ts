import { Uuid, type BountyMissionsResponse } from "@groundtruth/shared";
import { loadManagedBounty } from "@/lib/api/bountyAccess";
import { json, route, type IdParams } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { recessionSeries } from "@/lib/missions/recession";
import { expireMissions, missionsForBounty } from "@/lib/missions/repo";

/** Researcher (owner/admin): a request's revisit missions (upcoming/open/filled/expired) + recession series. */
export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireResearcher(req);
  const db = await getDb();
  const { bounty, protocol } = await loadManagedBounty(db, user, id);
  await expireMissions(db, new Date());
  const [missions, recession] = await Promise.all([missionsForBounty(db, bounty.id), recessionSeries(db, bounty.id, protocol.definition)]);
  const body: BountyMissionsResponse = {
    missions: missions.map((m) => ({
      id: m.id,
      cell: m.cell,
      sequence: m.sequence,
      interval_min: m.interval_min,
      due_at: m.due_at,
      opens_at: m.opens_at,
      closes_at: m.closes_at,
      dibs_until: m.dibs_until,
      status: m.status,
      source_submission_id: m.source_submission_id,
      filled_submission_id: m.filled_submission_id,
      filled_at: m.filled_at,
    })),
    recession,
  };
  return json(body);
});
