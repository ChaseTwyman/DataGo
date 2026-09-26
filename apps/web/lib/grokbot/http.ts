/** Route plumbing shared by every Grokbot endpoint. */
import { HttpError } from "../api/http";
import type { Db } from "../db";
import { enforceRateLimit, LIMITS } from "../rateLimit";

/**
 * Kill switch: GROKBOT_DISABLED=1 turns every Grokbot endpoint into 501 NOT_IMPLEMENTED (clients
 * show "not available" and keep working). The app's own flows never depend on Grokbot.
 */
export function assertGrokbotEnabled(): void {
  const v = process.env.GROKBOT_DISABLED;
  if (v === "1" || v === "true") throw new HttpError(501, "NOT_IMPLEMENTED", "The assistant is switched off right now.");
}

/**
 * `?refresh=1`: regenerate, bypassing the cache. Each refresh can cost a model call, so it has its
 * own per-user limit on top of the general one.
 */
export async function wantsRefresh(req: Request, db: Db, userId: string): Promise<boolean> {
  const v = new URL(req.url).searchParams.get("refresh");
  if (v !== "1" && v !== "true") return false;
  await enforceRateLimit(db, LIMITS.grokbotRefresh, userId);
  return true;
}
