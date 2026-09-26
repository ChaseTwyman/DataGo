import { ReverseContributionRequestSchema, Uuid } from "@groundtruth/shared";
import { conflict, json, notFound, parseBody, route, type IdParams } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getContribution, reverseContribution } from "@/lib/db/repos/funding";
import { contributionView } from "@/lib/funding/overview";

/** Admin: correct a contribution with a reversing entry (only money that isn't allocated yet). */
export const POST = route<IdParams>(async (req, { params }) => {
  const admin = await requireAdmin(req);
  const id = Uuid.parse((await params).id);
  const body = await parseBody(req, ReverseContributionRequestSchema);
  const db = await getDb();
  const orig = await getContribution(db, id);
  if (!orig || orig.kind !== "contribution") throw notFound("Contribution not found");
  const rid = await reverseContribution(db, id, body.amount_cents, body.note, admin.id);
  if (!rid) {
    throw conflict(
      "REVERSAL_REFUSED",
      "Can't reverse that much: only money that is not yet allocated to requests (and not already reversed) can be reversed. Reduce allocations first.",
    );
  }
  const r = (await getContribution(db, rid))!;
  return json({ contribution: contributionView(r, new Map([[orig.id, orig]])) }, { status: 201 });
});
