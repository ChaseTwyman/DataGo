import { PublishProtocolRequestSchema, Uuid } from "@groundtruth/shared";
import { conflict, forbidden, json, notFound, parseBody, route, type IdParams } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getProtocol, updateProtocolDefinition } from "@/lib/db/repos/protocols";

/** Publishes a draft (optionally with the researcher's edited definition). Owner or admin. */
export const POST = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireResearcher(req);
  const body = await parseBody(req, PublishProtocolRequestSchema);
  const db = await getDb();
  const p = await getProtocol(db, id);
  if (!p) throw notFound("Protocol not found");
  if (user.role !== "admin" && p.created_by !== user.id) throw forbidden("Not your protocol");
  if (p.status === "published") throw conflict("ALREADY_PUBLISHED", "Published protocols are immutable; draft a new version");
  // Slug and version stay as drafted: (slug, version) is unique and bounties pin a version.
  const def = { ...(body.definition ?? p.definition), slug: p.slug, version: p.version };
  await updateProtocolDefinition(db, id, def, "published");
  const out = (await getProtocol(db, id))!;
  return json({ id: out.id, slug: out.slug, version: out.version, name: out.name, status: out.status, definition: out.definition });
});
