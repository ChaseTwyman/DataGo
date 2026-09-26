import { Uuid } from "@groundtruth/shared";
import { json, mockVariantOf, route, type IdParams } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertGrokbotEnabled, wantsRefresh } from "@/lib/grokbot/http";
import { explainSubmission, loadSubmissionFor } from "@/lib/grokbot/submission";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const maxDuration = 30;

/**
 * Role-scoped explanation of a submission's outcome (GrokbotMessage). Contributors: integrity rejects
 * get only the neutral message; protocol rejects get concrete fixes from the protocol's required
 * elements. Researchers (bounty owner/admin): stage-level detail, no recommended decision.
 * `?refresh=1` regenerates (own rate limit).
 */
export const GET = route<IdParams>(async (req, { params }) => {
  assertGrokbotEnabled();
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.grokbot, user.id);
  const l = await loadSubmissionFor(db, user, id);
  const refresh = await wantsRefresh(req, db, user.id);
  return json(await explainSubmission(db, l, { mockError: mockVariantOf(req) === "error", refresh }), { headers: { "cache-control": "no-store" } });
});
