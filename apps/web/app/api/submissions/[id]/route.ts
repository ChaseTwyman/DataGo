import { Uuid } from "@groundtruth/shared";
import { json, notFound, originOf, route, type IdParams } from "@/lib/api/http";
import { submissionWithMedia } from "@/lib/api/views";
import { canManageBounty, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBounty } from "@/lib/db/repos/bounties";
import { getSubmission } from "@/lib/db/repos/submissions";

/** Owner or bounty owner. Polling fallback when realtime is unavailable (LOCAL_BACKEND). */
export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const db = await getDb();
  const s = await getSubmission(db, id);
  if (!s) throw notFound("Submission not found");
  const bounty = await getBounty(db, s.bounty_id);
  if (s.user_id !== user.id && !canManageBounty(user, bounty?.created_by ?? null)) throw notFound("Submission not found");
  return json(await submissionWithMedia(s, originOf(req), bounty?.title ?? null, user));
});
