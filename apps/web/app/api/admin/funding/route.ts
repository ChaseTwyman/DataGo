import { json, route } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fundingOverview } from "@/lib/funding/overview";

/** Admin: pool totals, per-earmark buckets, sponsors, pending and funded requests, recent ledger. */
export const GET = route(async (req) => {
  await requireAdmin(req);
  return json(await fundingOverview(await getDb()));
});
