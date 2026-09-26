import {
  payoutCents,
  payoutMultiplier,
  ReviewRequestSchema,
  updateTrust,
  Uuid,
  type ReasonCode,
  type ReviewResponseSchema,
} from "@groundtruth/shared";
import type { z } from "zod";
import { conflict, json, notFound, parseBody, route, type IdParams } from "@/lib/api/http";
import { canManageBounty, requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBounty, spendBudget } from "@/lib/db/repos/bounties";
import { insertLedger } from "@/lib/db/repos/ledger";
import { getProfile, setTrust } from "@/lib/db/repos/profiles";
import { getSession } from "@/lib/db/repos/sessions";
import { getSubmission, setReviewOutcome } from "@/lib/db/repos/submissions";

/**
 * Approve/reject a needs_review submission. Approve pays the locked quote × quality multiplier
 * (ledger payout + bounty spend) and applies review_approved to trust; reject applies
 * review_rejected (integrity rejections cost more trust).
 */
export const POST = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireResearcher(req);
  const body = await parseBody(req, ReviewRequestSchema);
  const db = await getDb();
  const sub = await getSubmission(db, id);
  if (!sub) throw notFound("Submission not found");
  const bounty = await getBounty(db, sub.bounty_id);
  if (!bounty || !canManageBounty(user, bounty.created_by)) throw notFound("Submission not found");
  if (sub.status !== "needs_review") throw conflict("NOT_IN_REVIEW", `Submission is ${sub.status}, not needs_review`);

  const session = sub.session_id ? await getSession(db, sub.session_id) : null;
  const res = await db.tx(async (tx) => {
    const profile = await getProfile(tx, sub.user_id);
    const trust = profile?.trust_score ?? 0.5;
    const codes = sub.reason_codes.filter((c) => c !== "LOW_TRUST_REVIEW" && c !== "BUDGET_EXHAUSTED");
    if (body.decision === "approve") {
      const amount = session ? payoutCents(session.price_quote_cents, payoutMultiplier(sub.protocol_score ?? 0.5)) : 0;
      if (amount > 0 && !(await spendBudget(tx, bounty.id, amount))) {
        throw conflict("BUDGET_EXHAUSTED", "Bounty budget cannot cover this payout; raise the budget first");
      }
      await setReviewOutcome(tx, id, { status: "accepted", reason_codes: codes, payout_cents: amount, reviewer: user.id, note: body.note ?? null });
      if (amount > 0) await insertLedger(tx, { user_id: sub.user_id, submission_id: id, amount_cents: amount, kind: "payout" });
      await setTrust(tx, sub.user_id, updateTrust(trust, { kind: "review_approved" }));
      return { submission_id: id, status: "accepted" as const, payout_cents: amount };
    }
    const rejectCodes: ReasonCode[] = [...new Set<ReasonCode>([...codes, "REVIEWER_REJECTED"])];
    await setReviewOutcome(tx, id, { status: "rejected", reason_codes: rejectCodes, payout_cents: 0, reviewer: user.id, note: body.note ?? null });
    await setTrust(tx, sub.user_id, updateTrust(trust, { kind: "review_rejected", integrity: body.integrity }));
    return { submission_id: id, status: "rejected" as const, payout_cents: 0 };
  });
  const out: z.infer<typeof ReviewResponseSchema> = res;
  return json(out);
});
