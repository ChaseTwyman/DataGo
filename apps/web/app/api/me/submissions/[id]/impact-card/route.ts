import { ImpactCardRequestSchema, Uuid, type ImpactCardResponse } from "@groundtruth/shared";
import { json, originOf, parseBody, route, type IdParams } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { impactCard } from "@/lib/impact/service";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";
import { getStorage } from "@/lib/storage";

export const maxDuration = 120;

/**
 * Shareable impact card for the caller's own accepted observation → image URL. The card never
 * contains the photo, the precise location or time, or any personal data (lib/impact/card.ts).
 * `ai_background: true` asks for a labelled Grok Imagine abstract background (pooled + capped; falls
 * back to the plain card with a note).
 */
export const POST = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const body = await parseBody(req, ImpactCardRequestSchema);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.impactCard, user.id);
  const storage = getStorage();
  const r = await impactCard(db, storage, user.id, id, { ai: body.ai_background });
  const res: ImpactCardResponse = {
    url: await storage.signedRead(r.path, originOf(req), 7 * 24 * 3600),
    ai_background: r.ai_background,
    cached: r.cached,
    note: r.note,
  };
  return json(res);
});
