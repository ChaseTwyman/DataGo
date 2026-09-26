import { Uuid } from "@groundtruth/shared";
import { json, mockVariantOf, route, type IdParams } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertGrokbotEnabled, wantsRefresh } from "@/lib/grokbot/http";
import { reviewBrief } from "@/lib/grokbot/reviewBrief";
import { loadSubmissionFor, submissionCase } from "@/lib/grokbot/submission";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const maxDuration = 30;

/**
 * Reviewer brief (researcher who owns the bounty, or admin): evidence with citations, uncertainties,
 * suggested manual checks, prompt-injection flags. No verdict: the human decides on
 * POST /api/submissions/:id/review. `?refresh=1` regenerates (own rate limit).
 */
export const GET = route<IdParams>(async (req, { params }) => {
  assertGrokbotEnabled();
  const id = Uuid.parse((await params).id);
  const user = await requireResearcher(req);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.grokbot, user.id);
  const l = await loadSubmissionFor(db, user, id, { managerOnly: true });
  const refresh = await wantsRefresh(req, db, user.id);
  const c = await submissionCase(db, l, "review_brief");
  return json(await reviewBrief(db, c, l.submission.id, { mockError: mockVariantOf(req) === "error", refresh }), { headers: { "cache-control": "no-store" } });
});
