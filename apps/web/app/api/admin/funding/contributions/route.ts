import { CreateContributionRequestSchema } from "@groundtruth/shared";
import { badRequest, json, notFound, parseBody, route } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBounty } from "@/lib/db/repos/bounties";
import { getContribution, getSponsor, insertContribution, listContributions } from "@/lib/db/repos/funding";
import { runAllocation } from "@/lib/funding/allocation";
import { contributionView } from "@/lib/funding/overview";

export const GET = route(async (req) => {
  await requireAdmin(req);
  const rows = await listContributions(await getDb(), 500);
  const byId = new Map(rows.map((c) => [c.id, c]));
  return json({ contributions: rows.map((c) => contributionView(c, byId)) });
});

/**
 * Admin: record a (simulated) sponsor contribution, optionally earmarked. Append-only; a mistake is
 * corrected with POST /api/admin/funding/contributions/:id/reverse. Runs the allocation engine so
 * pending requests are funded right away.
 */
export const POST = route(async (req) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, CreateContributionRequestSchema);
  const db = await getDb();
  const sponsor = await getSponsor(db, body.sponsor_id);
  if (!sponsor) throw notFound("Sponsor not found");
  if (!sponsor.active) throw badRequest("This sponsor is inactive; reactivate it first.");
  if (body.bounty_id) {
    const b = await getBounty(db, body.bounty_id);
    if (!b) throw notFound("Request not found");
    if (b.status === "closed") throw badRequest("That request is closed.");
  }
  const id = await insertContribution(db, body, admin.id);
  const allocation = await runAllocation(db);
  const c = (await getContribution(db, id))!;
  return json({ contribution: contributionView(c, new Map([[c.id, c]])), allocation }, { status: 201 });
});
