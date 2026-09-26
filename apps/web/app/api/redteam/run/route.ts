import { RedteamRunRequestSchema } from "@groundtruth/shared";
import { loadManagedBounty } from "@/lib/api/bountyAccess";
import { HttpError, json, originOf, parseBody, route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { GrokError } from "@/lib/grok/config";
import { runAttack } from "@/lib/redteam";
import { getStorage } from "@/lib/storage";
import { liveDeps } from "@/lib/verification/deps";

export const maxDuration = 120;

/** Runs one attack through the pipeline (skipping only session integrity). Writes redteam_runs only. */
export const POST = route(async (req) => {
  const user = await requireResearcher(req);
  const body = await parseBody(req, RedteamRunRequestSchema);
  const db = await getDb();
  const { bounty, protocol } = await loadManagedBounty(db, user, body.bounty_id);
  try {
    const res = await runAttack({ db, storage: getStorage(), deps: liveDeps(db), bounty, protocol, attack: body.attack_type, origin: originOf(req) });
    return json(res);
  } catch (err) {
    if (err instanceof GrokError) throw new HttpError(502, "GROK_UNAVAILABLE", err.message);
    throw err;
  }
});
