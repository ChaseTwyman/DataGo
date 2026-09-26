import { PatchSponsorRequestSchema, Uuid } from "@groundtruth/shared";
import { conflict, json, notFound, parseBody, route, type IdParams } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getSponsor, patchSponsor, sponsorNameTaken } from "@/lib/db/repos/funding";

/** Admin: edit a sponsor's profile or deactivate it. Sponsors are never deleted (the ledger refers to them). */
export const PATCH = route<IdParams>(async (req, { params }) => {
  await requireAdmin(req);
  const id = Uuid.parse((await params).id);
  const body = await parseBody(req, PatchSponsorRequestSchema);
  const db = await getDb();
  if (!(await getSponsor(db, id))) throw notFound("Sponsor not found");
  if (body.name && (await sponsorNameTaken(db, body.name, id))) throw conflict("SPONSOR_EXISTS", "A sponsor with that name already exists.");
  await patchSponsor(db, id, body);
  return json(await getSponsor(db, id));
});
