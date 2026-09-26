import { SignupRequestSchema, type SignupResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { conflict, json, parseBody, route } from "@/lib/api/http";
import { EmailTakenError, getAccountAuth } from "@/lib/account/authAdmin";
import { initProfile } from "@/lib/account/service";
import { getDb } from "@/lib/db";
import { clientIp, enforceRateLimit, LIMITS } from "@/lib/rateLimit";

/**
 * Creates an email+password account (no auth). The Supabase admin API creates the user already
 * confirmed, so no email is sent; the client then signs in with the password grant.
 * Rate-limited per IP (every attempt counts, so it also slows email enumeration).
 */
export const POST = route(async (req) => {
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.signup, clientIp(req));
  const body = await parseBody(req, SignupRequestSchema);
  let id: string;
  try {
    id = (await getAccountAuth().createUser(body.email, body.password, body.display_name)).id;
  } catch (err) {
    if (err instanceof EmailTakenError) throw conflict("EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
    throw err;
  }
  await initProfile(db, id, body.display_name);
  const res: z.infer<typeof SignupResponseSchema> = { user_id: id };
  return json(res, { status: 201 });
});
