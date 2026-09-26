import { PasswordResetRequestSchema, type PasswordResetRequestResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { json, parseBody, route } from "@/lib/api/http";
import { getAccountAuth } from "@/lib/account/authAdmin";
import { runInBackground } from "@/lib/background";
import { getDb } from "@/lib/db";
import { passwordResetRedirectUrl } from "@/lib/env";
import { clientIp, enforceRateLimit, LIMITS } from "@/lib/rateLimit";

const ACCEPTED: z.infer<typeof PasswordResetRequestResponseSchema> = { ok: true };

/**
 * Forgot password, step 1 (no auth): emails a recovery code + link if the address has an account.
 *
 * No account enumeration: the answer is always 202 with the same body, and the email is sent after
 * the response (next/server `after`), so neither the body nor the response time depends on whether
 * the account exists or the mail provider is slow. Failures are logged server-side only.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.resetRequestIp, clientIp(req));
  const { email } = await parseBody(req, PasswordResetRequestSchema);
  await enforceRateLimit(db, LIMITS.resetRequestEmail, email);
  const auth = getAccountAuth();
  const redirectTo = passwordResetRedirectUrl();
  runInBackground(async () => {
    try {
      await auth.requestPasswordReset(email, redirectTo);
    } catch (err) {
      // No email address in the log line: the reason is enough to debug SMTP/config problems.
      console.warn("[password-reset] request failed:", err instanceof Error ? err.message : "unknown error");
    }
  });
  return json(ACCEPTED, { status: 202, headers: { "cache-control": "no-store" } });
});
