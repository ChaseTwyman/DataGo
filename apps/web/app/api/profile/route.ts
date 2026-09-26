import { ProfileRequestSchema } from "@groundtruth/shared";
import { json, parseBody, route } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { updateProfile } from "@/lib/db/repos/profiles";

/** Updates the caller's profile (onboarding form or voice `save_profile`). Role and trust are server-owned. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, ProfileRequestSchema);
  const p = await updateProfile(await getDb(), user.id, body);
  return json({ id: p.id, role: p.role, trust_score: p.trust_score });
});
