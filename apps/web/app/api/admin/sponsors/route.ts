import { CreateSponsorRequestSchema } from "@groundtruth/shared";
import { conflict, json, parseBody, route } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getSponsor, insertSponsor, listSponsors, sponsorNameTaken } from "@/lib/db/repos/funding";

/** Admin: sponsors with their net contributions. */
export const GET = route(async (req) => {
  await requireAdmin(req);
  return json({ sponsors: await listSponsors(await getDb()) });
});

export const POST = route(async (req) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, CreateSponsorRequestSchema);
  const db = await getDb();
  if (await sponsorNameTaken(db, body.name)) throw conflict("SPONSOR_EXISTS", "A sponsor with that name already exists.");
  const id = await insertSponsor(db, body, admin.id);
  return json(await getSponsor(db, id), { status: 201 });
});
