import { AttackTypeSchema, Uuid, type RedteamRunRowSchema } from "@groundtruth/shared";
import { z } from "zod";
import { json, originOf, parseQuery, route } from "@/lib/api/http";
import { researcherMediaUrl } from "@/lib/api/views";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listBountiesFor } from "@/lib/db/repos/bounties";
import { listRedteamRuns } from "@/lib/db/repos/redteam";

const Query = z.object({ bounty_id: Uuid.optional() });

/** Red-team history for the researcher's bounties (admin: all), newest first. */
export const GET = route(async (req) => {
  const user = await requireResearcher(req);
  const q = parseQuery(req, Query);
  const db = await getDb();
  const ids = user.isAdmin ? null : (await listBountiesFor(db, user.id, false)).map((b) => b.id);
  const rows = await listRedteamRuns(db, ids, q.bounty_id);
  const origin = originOf(req);
  const runs: z.infer<typeof RedteamRunRowSchema>[] = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      bounty_id: r.bounty_id,
      attack_type: AttackTypeSchema.parse(r.attack_type),
      caught: r.caught,
      status: r.pipeline_result.status,
      reason_codes: r.pipeline_result.reason_codes ?? [],
      checks: r.pipeline_result.checks ?? [],
      // Older "recycled" runs stored an original observation path: researchers get its redacted sibling.
      image_url: await researcherMediaUrl(r.pipeline_result.image_path ?? null, origin, user),
      created_at: r.created_at,
    })),
  );
  return json({ runs });
});
