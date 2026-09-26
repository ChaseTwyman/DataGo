import { DraftProtocolRequestSchema, type DraftProtocolResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { insertProtocol } from "@/lib/db/repos/protocols";
import { GrokError } from "@/lib/grok/config";
import { draftProtocol } from "@/lib/studio";

export const maxDuration = 180;

/** Protocol Studio: plain-language need → grok-4.7 draft (validated against ProtocolSchema) saved as a draft. */
export const POST = route(async (req) => {
  const user = await requireResearcher(req);
  const { need } = await parseBody(req, DraftProtocolRequestSchema);
  let protocol;
  try {
    protocol = await draftProtocol(need);
  } catch (err) {
    if (err instanceof GrokError) throw new HttpError(502, "GROK_UNAVAILABLE", err.message);
    throw err;
  }
  const db = await getDb();
  // (slug, version) is unique: bump the version past any existing one.
  const v = await db.query<{ v: number }>("select coalesce(max(version), 0)::int as v from public.protocols where slug = $1", [protocol.slug]);
  protocol = { ...protocol, version: (v[0]?.v ?? 0) + 1 };
  const id = await insertProtocol(db, protocol, user.id, "draft");
  const body: z.infer<typeof DraftProtocolResponseSchema> = { protocol_id: id, protocol };
  return json(body, { status: 201 });
});
