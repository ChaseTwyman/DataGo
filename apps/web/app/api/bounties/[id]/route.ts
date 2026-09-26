import { PatchBountyRequestSchema, Uuid } from "@groundtruth/shared";
import { loadManagedBounty, loadVisibleBounty } from "@/lib/api/bountyAccess";
import { badRequest, conflict, forbidden, json, originOf, parseBody, route, type IdParams } from "@/lib/api/http";
import { bountyDetail } from "@/lib/api/views";
import { canManageBounty, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBounty, patchBounty } from "@/lib/db/repos/bounties";
import { getProtocol } from "@/lib/db/repos/protocols";
import { closeRequest } from "@/lib/funding/allocation";

export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const db = await getDb();
  const { bounty, protocol } = await loadVisibleBounty(db, user, id);
  return json(await bountyDetail(db, bounty, protocol, originOf(req), { manage: canManageBounty(user, bounty.created_by) }));
});

/**
 * Owners: title, summary, ends_at, status (pause ↔ resume, close). Admins also: target_per_cell and
 * sponsor display fields. Prices, priority and budget are platform-owned and refused here; an
 * allocation changes only through the allocation engine or /api/admin/bounties/:id/allocation.
 */
export const PATCH = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const body = await parseBody(req, PatchBountyRequestSchema);
  const db = await getDb();
  const { bounty } = await loadManagedBounty(db, user, id);

  if (body.base_price_cents !== undefined || body.max_price_cents !== undefined || body.priority !== undefined) {
    throw forbidden("Prices are set by the GroundTruth pricing engine.");
  }
  if (body.budget_cents !== undefined) {
    throw forbidden("Allocations come from the sponsor pool; an admin can adjust them on the Funding page.");
  }
  if (!user.isAdmin && (body.target_per_cell !== undefined || body.sponsor_name !== undefined || body.sponsor_url !== undefined)) {
    throw forbidden("Only admins can change the target or sponsor of a funded request.");
  }
  if (body.ends_at && Date.parse(body.ends_at) <= Date.parse(bounty.starts_at)) throw badRequest("ends_at <= starts_at");

  const status = body.status;
  if (status !== undefined && status !== bounty.status) {
    if (bounty.status === "closed") throw conflict("REQUEST_CLOSED", "This request is closed.");
    if (status === "pending_funding" || status === "draft") throw badRequest("A request can't be moved back to that status.");
    if (status === "active" && bounty.budget_cents <= bounty.spent_cents) {
      throw conflict("NOT_FUNDED", "This request has no allocation left. It is activated when the sponsor pool funds it.");
    }
  }

  const { status: _s, ...rest } = body;
  void _s;
  await patchBounty(db, id, rest);
  if (status !== undefined && status !== bounty.status) {
    if (status === "closed") await closeRequest(db, id, user.id);
    else await patchBounty(db, id, { status });
  }
  const updated = (await getBounty(db, id))!;
  const protocol = (await getProtocol(db, updated.protocol_id))!;
  return json(await bountyDetail(db, updated, protocol, originOf(req), { manage: true }));
});
