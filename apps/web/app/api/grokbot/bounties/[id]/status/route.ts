import { Uuid } from "@groundtruth/shared";
import { json, mockVariantOf, route, type IdParams } from "@/lib/api/http";
import { loadManagedBounty } from "@/lib/api/bountyAccess";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestStatus } from "@/lib/grokbot/bounty";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const maxDuration = 30;

/**
 * Request status for its owner (or an admin): funded / pending_funding (with the allocator's own
 * reason) / paused / pacing, with "what would help" next steps. Changing anything stays a human
 * action on the existing endpoints.
 */
export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.grokbot, user.id);
  const { bounty, protocol } = await loadManagedBounty(db, user, id);
  return json(await requestStatus(db, bounty, protocol, { mockError: mockVariantOf(req) === "error" }), { headers: { "cache-control": "no-store" } });
});
