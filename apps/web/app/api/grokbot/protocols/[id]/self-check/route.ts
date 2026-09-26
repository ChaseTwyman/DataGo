import { Uuid, type StudioSelfCheck } from "@groundtruth/shared";
import { forbidden, grokUnavailable, json, mockVariantOf, notFound, originOf, route, type IdParams } from "@/lib/api/http";
import { mediaUrl } from "@/lib/api/views";
import { requireResearcher, type AuthUser } from "@/lib/auth";
import { getDb, type Db } from "@/lib/db";
import { getProtocol } from "@/lib/db/repos/protocols";
import { GrokError } from "@/lib/grok/config";
import { runSelfCheck, storedSelfCheck } from "@/lib/grokbot/selfCheck";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";
import { getStorage } from "@/lib/storage";
import { assertGrokbotEnabled } from "@/lib/grokbot/http";

// Example generation (~16 s on Vercel) + 3 frame checks and a relevance screen in parallel.
export const maxDuration = 180;

async function ownedProtocol(db: Db, user: AuthUser, id: string) {
  const p = await getProtocol(db, id);
  if (!p) throw notFound("Protocol not found");
  if (!user.isAdmin && p.created_by !== user.id) throw forbidden("Not your protocol");
  return p;
}

async function withImageUrl(r: StudioSelfCheck, path: string | null, origin: string): Promise<StudioSelfCheck> {
  return { ...r, example_image_url: await mediaUrl(path, origin, 24 * 3600) };
}

/**
 * Studio self-check (protocol owner or admin): runs the example image through the live frame check
 * (x3) and relevance screen; stores the result on the protocol. Advisory: publishing is never blocked.
 */
export const POST = route<IdParams>(async (req, { params }) => {
  assertGrokbotEnabled();
  const id = Uuid.parse((await params).id);
  const user = await requireResearcher(req);
  const db = await getDb();
  const p = await ownedProtocol(db, user, id);
  await enforceRateLimit(db, LIMITS.selfCheck, user.id);
  const variant = mockVariantOf(req);
  try {
    const r = await runSelfCheck(db, getStorage(), p, variant ? { variant } : {});
    const path = (await getProtocol(db, id))?.example_image_path ?? null;
    return json(await withImageUrl(r, path, originOf(req)));
  } catch (err) {
    if (err instanceof GrokError) throw grokUnavailable(err, "self-check");
    throw err;
  }
});

/** The last stored self-check (404 when none has run). */
export const GET = route<IdParams>(async (req, { params }) => {
  assertGrokbotEnabled();
  const id = Uuid.parse((await params).id);
  const user = await requireResearcher(req);
  const db = await getDb();
  const p = await ownedProtocol(db, user, id);
  const r = await storedSelfCheck(db, id);
  if (!r) throw notFound("No self-check has run for this protocol");
  return json(await withImageUrl(r, p.example_image_path, originOf(req)));
});
