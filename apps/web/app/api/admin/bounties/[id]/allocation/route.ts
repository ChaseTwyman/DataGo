import { SetAllocationRequestSchema, Uuid, type AllocationResult } from "@groundtruth/shared";
import { json, parseBody, route, type IdParams } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { setAllocation } from "@/lib/funding/allocation";

/**
 * Admin: approve a pending request or adjust a request's allocation to an exact total. Draws
 * earmarks first, then the general pool; releases go back general pool first. Never below what is
 * already paid or promised to contributors.
 */
export const POST = route<IdParams>(async (req, { params }) => {
  const admin = await requireAdmin(req);
  const id = Uuid.parse((await params).id);
  const body = await parseBody(req, SetAllocationRequestSchema);
  const r = await setAllocation(await getDb(), id, body.allocation_cents, body.reason, admin.id);
  const res: AllocationResult = { bounty_id: r.bountyId, status: r.status, allocation_cents: r.allocationCents, funding_reason: r.fundingReason };
  return json(res);
});
