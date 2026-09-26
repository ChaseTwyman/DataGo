import { BecomeResearcherRequestSchema } from "@groundtruth/shared";
import { json, parseBody, route } from "@/lib/api/http";
import { disableResearcher, enableResearcher, getMe } from "@/lib/account/service";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Self-serve researcher access: organization + purpose + terms. Refused after an admin revoke. → Me */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, BecomeResearcherRequestSchema);
  const db = await getDb();
  await enableResearcher(db, user.id, { organization: body.organization, purpose: body.purpose });
  return json(await getMe(db, user));
});

/** Turn researcher access off (bounties stay; the account keeps contributing). → Me */
export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  await disableResearcher(db, user.id);
  return json(await getMe(db, user));
});
