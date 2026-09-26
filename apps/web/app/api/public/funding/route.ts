import { json, route } from "@/lib/api/http";
import { getDb } from "@/lib/db";
import { publicFunding } from "@/lib/funding/overview";

/** Public (no login): sponsors and sponsor-pool totals. No per-user or per-request data. */
export const GET = route(async () => {
  return json(await publicFunding(await getDb()), { headers: { "cache-control": "public, max-age=60" } });
});
