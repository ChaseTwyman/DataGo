import type { MatchRefreshResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { json, route } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { refreshMatches } from "@/lib/grokbot/match";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const maxDuration = 30;

/** Recomputes the caller's For-you matches now (one batched fast-model call). Rate-limited. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.matchRefresh, user.id);
  const body: z.infer<typeof MatchRefreshResponseSchema> = { refreshed: await refreshMatches(db, user.id) };
  return json(body);
});
