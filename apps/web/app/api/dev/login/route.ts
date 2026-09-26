import { EmailSchema, type DevSessionResponse } from "@groundtruth/shared";
import { z } from "zod";
import { assertLocalBackend } from "@/lib/api/devOnly";
import { HttpError, json, parseBody, route } from "@/lib/api/http";
import { LocalAccountAuth } from "@/lib/account/authAdmin";
import { devTokenFor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getProfile } from "@/lib/db/repos/profiles";

const DevLoginSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(200) });

/**
 * LOCAL_BACKEND=1 only: the local stand-in for Supabase's password grant, so "Create account" and
 * "Sign in" work without Supabase. Returns a dev bearer token (same shape as /api/dev/session).
 */
export const POST = route(async (req) => {
  assertLocalBackend();
  const body = await parseBody(req, DevLoginSchema);
  const id = await new LocalAccountAuth().signInLocal(body.email, body.password);
  if (!id) throw new HttpError(400, "INVALID_CREDENTIALS", "That email and password don't match.");
  const p = await getProfile(await getDb(), id);
  if (!p) throw new HttpError(400, "INVALID_CREDENTIALS", "That email and password don't match.");
  const res: DevSessionResponse = { user_id: id, access_token: devTokenFor(id), role: p.role };
  return json(res);
});
