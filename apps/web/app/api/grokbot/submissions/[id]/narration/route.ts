import { Uuid } from "@groundtruth/shared";
import { z } from "zod";
import { json, mockVariantOf, parseQuery, route, type IdParams } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadSubmissionFor, narrate } from "@/lib/grokbot/submission";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const maxDuration = 30;

const Query = z.object({ after: z.coerce.number().int().min(-1).max(1000).default(0) });

/**
 * Verification companion (submission owner → contributor view; bounty owner/admin → researcher
 * view; anyone else 404). Poll with `after` = the last seq you have (seq is 1-based and contiguous,
 * so that is also the number of lines you have). `final` is set once the submission is terminal.
 */
export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const { after } = parseQuery(req, Query);
  const user = await requireUser(req);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.grokbot, user.id);
  const l = await loadSubmissionFor(db, user, id);
  return json(await narrate(db, l, after, { mockError: mockVariantOf(req) === "error" }), { headers: { "cache-control": "no-store" } });
});
