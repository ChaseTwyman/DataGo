import { ProfileRequestSchema } from "@groundtruth/shared";
import { json, parseBody, route } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { getDb } from "@/lib/db";
import { updateProfile } from "@/lib/db/repos/profiles";
import { autoRefreshMatches, invalidateMatches } from "@/lib/grokbot/match";

/** Updates the caller's profile (onboarding form or voice `save_profile`). Role and trust are server-owned. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, ProfileRequestSchema);
  const db = await getDb();
  const p = await updateProfile(db, user.id, body);
  // Grokbot For-you: match reasons were computed from the old profile; drop them and recompute.
  const matchInputs = [body.occupation, body.skills, body.interests, body.languages, body.regular_areas];
  if (matchInputs.some((v) => v !== undefined)) {
    await invalidateMatches(db, user.id);
    runInBackground(() => autoRefreshMatches(db, user.id));
  }
  return json({ id: p.id, role: p.role, trust_score: p.trust_score });
});
