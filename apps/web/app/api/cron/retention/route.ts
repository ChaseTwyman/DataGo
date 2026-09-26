import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError, json, route } from "@/lib/api/http";
import { getDb } from "@/lib/db";
import { runAllocation } from "@/lib/funding/allocation";
import { pruneGrokbotCache } from "@/lib/grokbot/cache";
import { pruneRateLimits } from "@/lib/rateLimit";
import { purgeRejectedMedia } from "@/lib/retention";
import { getStorage } from "@/lib/storage";
import { liveRedactionDeps, redactBacklog } from "@/lib/verification/redaction";

export const maxDuration = 60;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends exactly this). Refused when CRON_SECRET is unset. */
function assertCron(req: Request): void {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !timingSafeEqual(digest(got), digest(`Bearer ${secret}`))) {
    throw new HttpError(401, "UNAUTHORIZED", "Unauthorized");
  }
}

const run = route(async (req) => {
  assertCron(req);
  const db = await getDb();
  const media = await purgeRejectedMedia(db, getStorage());
  const rateLimitWindows = await pruneRateLimits(db);
  const grokbotCachePruned = await pruneGrokbotCache(db);
  // Sponsor pool housekeeping: release money from ended requests, fund pending ones.
  const allocation = await runAllocation(db);
  // Retry failed / missing face-plate redactions (small batch: this route has 60 s).
  const redaction = await redactBacklog(db, liveRedactionDeps(getStorage()), 5);
  return json({ ok: true, rejected_media: media, rate_limit_windows_pruned: rateLimitWindows, grokbot_cache_pruned: grokbotCachePruned, allocation, redaction });
});

/** Vercel Cron invokes GET (vercel.json, daily); POST for manual runs. */
export const GET = run;
export const POST = run;
