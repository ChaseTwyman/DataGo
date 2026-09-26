import { randomUUID } from "node:crypto";
import { DEMO, DevSessionRequestSchema, type DevSessionResponse } from "@groundtruth/shared";
import { assertLocalBackend } from "@/lib/api/devOnly";
import { badRequest, json, parseBody, route } from "@/lib/api/http";
import { devTokenFor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureDevUser } from "@/lib/db/repos/profiles";

/**
 * LOCAL_BACKEND=1 only: mints a dev bearer token without Supabase Auth.
 * contributor → new (or reused) dev account dev+<id>@local (a real, non-anonymous account);
 * researcher/admin → the seeded demo admin.
 */
export const POST = route(async (req) => {
  assertLocalBackend();
  const body = await parseBody(req, DevSessionRequestSchema);
  const db = await getDb();
  if (body.role === "contributor" && body.user_id === DEMO.researcherId) throw badRequest("That id is the researcher account");
  const id = body.role === "contributor" ? (body.user_id ?? randomUUID()) : DEMO.researcherId;
  const profile = await ensureDevUser(db, id, body.role === "contributor" ? "contributor" : "admin");
  const res: DevSessionResponse = { user_id: id, access_token: devTokenFor(id), role: profile.role };
  return json(res);
});
