import { Uuid, type ExampleImageResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { forbidden, HttpError, json, notFound, originOf, route, type IdParams } from "@/lib/api/http";
import { mediaUrl } from "@/lib/api/views";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getProtocol } from "@/lib/db/repos/protocols";
import { generateExampleImage } from "@/lib/examples";
import { GrokError } from "@/lib/grok/config";
import { getStorage } from "@/lib/storage";

export const maxDuration = 120;

/** (Re)generates the protocol's Grok Imagine example image. `?force=1` regenerates an existing one. */
export const POST = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireResearcher(req);
  const db = await getDb();
  const protocol = await getProtocol(db, id);
  if (!protocol) throw notFound("Protocol not found");
  if (user.role !== "admin" && protocol.created_by !== user.id) throw forbidden("Not your protocol");
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const { path } = await generateExampleImage(db, getStorage(), protocol, { force });
    const url = await mediaUrl(path, originOf(req), 24 * 3600);
    const body: z.infer<typeof ExampleImageResponseSchema> = { path, url: url ?? "" };
    return json(body);
  } catch (err) {
    if (err instanceof GrokError) throw new HttpError(502, "GROK_UNAVAILABLE", err.message);
    throw err;
  }
});
