/**
 * Backfill face / licence-plate redaction for decided submissions that have none yet (or whose last
 * attempt failed, up to REDACTION_MAX_ATTEMPTS). Idempotent: safe to re-run; `done` rows are skipped.
 *
 *   cd apps/web
 *   npx tsx --env-file=.env scripts/backfill-redaction.ts            # all, in batches of 10
 *   npx tsx --env-file=.env scripts/backfill-redaction.ts --dry-run  # just count
 *   ... --max 50                                                     # stop after 50 submissions
 *
 * Needs migration 20260926000009_redaction.sql applied first. Real DB: DATABASE_URL + Supabase
 * service role (storage) + XAI_API_KEY (one fast-vision call per frame). LOCAL_BACKEND=1 works too.
 * Never changes a verification decision; failures are recorded on the row and retried by the cron.
 */
import { getDb } from "../lib/db";
import { redactionBacklog } from "../lib/db/repos/submissions";
import { getStorage } from "../lib/storage";
import { liveRedactionDeps, redactSubmissionSafely, type RedactionOutcome } from "../lib/verification/redaction";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const db = await getDb();
  const max = Number(argValue("--max") ?? Number.POSITIVE_INFINITY);
  if (process.argv.includes("--dry-run")) {
    console.log(`${(await redactionBacklog(db, 100_000)).length} submission(s) need redaction`);
    return;
  }
  const deps = liveRedactionDeps(getStorage());
  const totals: Record<RedactionOutcome, number> = { done: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>();
  while (seen.size < max) {
    // Failed rows stay in the backlog (until their attempt cap), so never retry one in the same run.
    const batch = (await redactionBacklog(db, 10 + seen.size)).filter((id) => !seen.has(id)).slice(0, Math.min(10, max - seen.size));
    if (batch.length === 0) break;
    for (const id of batch) {
      seen.add(id);
      const r = await redactSubmissionSafely(db, id, deps);
      totals[r]++;
      console.log(`${id} ${r}`);
    }
  }
  console.log(`done ${totals.done}, failed ${totals.failed}, skipped ${totals.skipped}`);
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
