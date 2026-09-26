import { RedteamRunRequestSchema } from "@groundtruth/shared";
import { loadManagedBounty } from "@/lib/api/bountyAccess";
import { grokUnavailable, json, originOf, parseBody, route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { GrokError } from "@/lib/grok/config";
import { runAttack } from "@/lib/redteam";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";
import { getStorage } from "@/lib/storage";
import { liveDeps } from "@/lib/verification/deps";

// Imagine (~15 s) + grok-4.7 verification (~30 s locally, more on Vercel; the SDK retries a
// timed-out call once). 120 s timed out on Vercel; 300 is the Hobby maximum.
export const maxDuration = 300;

/** Runs one attack through the pipeline (skipping only session integrity). Writes redteam_runs only. */
export const POST = route(async (req) => {
  const user = await requireResearcher(req);
  const body = await parseBody(req, RedteamRunRequestSchema);
  const db = await getDb();
  const { bounty, protocol } = await loadManagedBounty(db, user, body.bounty_id);
  await enforceRateLimit(db, LIMITS.redteam, user.id);
  try {
    const res = await runAttack({ db, storage: getStorage(), deps: liveDeps(db), bounty, protocol, attack: body.attack_type, origin: originOf(req) });
    return json(res);
  } catch (err) {
    if (err instanceof GrokError) throw grokUnavailable(err, "red-team run");
    throw err;
  }
});
