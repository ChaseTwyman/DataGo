import { json, originOf, route } from "@/lib/api/http";
import { mediaUrl } from "@/lib/api/views";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listProtocols } from "@/lib/db/repos/protocols";

/** Published protocols plus the caller's own drafts (admins: all). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const rows = await listProtocols(await getDb(), user.id, user.role === "admin");
  const origin = originOf(req);
  const protocols = await Promise.all(
    rows.map(async (p) => ({
      id: p.id,
      slug: p.slug,
      version: p.version,
      name: p.name,
      status: p.status,
      example_image_url: await mediaUrl(p.example_image_path, origin, 24 * 3600),
      definition: p.definition,
    })),
  );
  return json({ protocols });
});
