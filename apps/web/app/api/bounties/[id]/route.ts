import { PatchBountyRequestSchema, Uuid } from "@groundtruth/shared";
import { loadManagedBounty, loadVisibleBounty } from "@/lib/api/bountyAccess";
import { badRequest, json, originOf, parseBody, route, type IdParams } from "@/lib/api/http";
import { bountyDetail } from "@/lib/api/views";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBounty, patchBounty } from "@/lib/db/repos/bounties";
import { getProtocol } from "@/lib/db/repos/protocols";

export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const db = await getDb();
  const { bounty, protocol } = await loadVisibleBounty(db, user, id);
  return json(await bountyDetail(db, bounty, protocol, originOf(req)));
});

export const PATCH = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const body = await parseBody(req, PatchBountyRequestSchema);
  const db = await getDb();
  const { bounty } = await loadManagedBounty(db, user, id);
  const base = body.base_price_cents ?? bounty.base_price_cents;
  const max = body.max_price_cents ?? bounty.max_price_cents;
  if (max < base) throw badRequest("max_price_cents < base_price_cents");
  if (body.ends_at && Date.parse(body.ends_at) <= Date.parse(bounty.starts_at)) throw badRequest("ends_at <= starts_at");
  await patchBounty(db, id, body);
  const updated = (await getBounty(db, id))!;
  const protocol = (await getProtocol(db, updated.protocol_id))!;
  return json(await bountyDetail(db, updated, protocol, originOf(req)));
});
