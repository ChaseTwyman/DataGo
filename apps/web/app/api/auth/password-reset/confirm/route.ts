import {
  PasswordResetCodeConfirmSchema,
  PasswordResetLinkConfirmSchema,
  type PasswordResetConfirmResponseSchema,
} from "@groundtruth/shared";
import type { z } from "zod";
import { badRequest, HttpError, json, route } from "@/lib/api/http";
import { getAccountAuth, RecoveryRateLimitedError, type RecoveredUser } from "@/lib/account/authAdmin";
import { getDb } from "@/lib/db";
import { clientIp, enforceRateLimit, LIMITS, rateLimited } from "@/lib/rateLimit";

const resetCodeInvalid = () =>
  new HttpError(400, "RESET_CODE_INVALID", "That code is wrong or has expired. Check the latest email, or request a new code.");

/**
 * Forgot password, step 2 (no auth): redeem the emailed code (+ email) or the link's token_hash,
 * set the new password, then sign the account out on every device.
 *
 * Brute force: every attempt counts against the caller's IP and, for codes, against the email
 * (LIMITS.resetConfirmEmail), whether or not the code is right. A token_hash is a long random
 * hash, so it's limited per IP only. Suspended accounts may reset; sign-in stays blocked by the
 * normal suspension checks.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.resetConfirmIp, clientIp(req));
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Body must be JSON");
  }
  const viaLink = typeof raw === "object" && raw !== null && "token_hash" in raw;
  const auth = getAccountAuth();

  let user: RecoveredUser | null;
  let newPassword: string;
  try {
    if (viaLink) {
      const body = PasswordResetLinkConfirmSchema.parse(raw);
      newPassword = body.new_password;
      user = await auth.verifyRecovery({ tokenHash: body.token_hash });
    } else {
      const body = PasswordResetCodeConfirmSchema.parse(raw);
      await enforceRateLimit(db, LIMITS.resetConfirmEmail, body.email);
      newPassword = body.new_password;
      user = await auth.verifyRecovery({ email: body.email, code: body.code });
    }
  } catch (err) {
    if (err instanceof RecoveryRateLimitedError) throw rateLimited(viaLink ? LIMITS.resetConfirmIp : LIMITS.resetConfirmEmail);
    throw err;
  }
  if (!user) throw resetCodeInvalid();

  await auth.setPassword(user.id, newPassword);
  // Revocation matters most when the reset is locking out someone who stole the password, so a
  // transient failure gets one retry, and a lasting one is reported to the client (which then must
  // not claim "signed out everywhere") instead of being swallowed.
  let sessionsRevoked = false;
  for (let attempt = 1; attempt <= 2 && !sessionsRevoked; attempt++) {
    try {
      await auth.revokeSessions(user);
      sessionsRevoked = true;
    } catch (err) {
      console.warn(`[password-reset] revoking sessions of ${user.id} failed (attempt ${attempt}):`, err instanceof Error ? err.message : "unknown error");
    }
  }
  console.info(`[password-reset] ${user.id} reset their password${viaLink ? " (link)" : ""}`);
  const res: z.infer<typeof PasswordResetConfirmResponseSchema> = { ok: true, email: user.email, sessions_revoked: sessionsRevoked };
  return json(res, { headers: { "cache-control": "no-store" } });
});
