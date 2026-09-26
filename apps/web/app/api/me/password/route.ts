import { ChangePasswordRequestSchema } from "@groundtruth/shared";
import { HttpError, json, parseBody, route } from "@/lib/api/http";
import { getAccountAuth } from "@/lib/account/authAdmin";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

/** Change password: the current one is verified with a password grant, then set via the admin API. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  await enforceRateLimit(await getDb(), LIMITS.passwordChange, user.id);
  const body = await parseBody(req, ChangePasswordRequestSchema);
  if (!user.email) throw new HttpError(400, "INVALID_CREDENTIALS", "This account has no email to check the password against.");
  const auth = getAccountAuth();
  if (!(await auth.verifyPassword(user.email, body.current_password))) {
    throw new HttpError(400, "INVALID_CREDENTIALS", "Your current password is incorrect.");
  }
  await auth.setPassword(user.id, body.new_password);
  return json({ ok: true });
});
