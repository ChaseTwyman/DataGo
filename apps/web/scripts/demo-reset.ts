/**
 * Resets the database to the demo state (seeded researcher, flood protocol, one active demo bounty).
 *   LOCAL_BACKEND=1 pnpm demo:reset   # deletes apps/web/.local (PGlite + storage) and re-seeds. Stop `next dev` first.
 *   pnpm demo:reset                   # Supabase via DATABASE_URL: wipes app tables and re-runs supabase/seed.sql.
 * Keeps protocol example images (so the demo doesn't need Grok Imagine again).
 */
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEMO } from "@groundtruth/shared";
import { findSupabaseDir, openPglite, readSchemaFiles } from "../lib/db/pglite";
import { isLocalBackend } from "../lib/env";

async function resetLocal(): Promise<void> {
  const root = resolve(process.env.LOCAL_DATA_DIR || join(process.cwd(), ".local"));
  const pgDir = resolve(process.env.PGLITE_DIR || join(root, "pglite"));
  rmSync(pgDir, { recursive: true, force: true });
  rmSync(join(root, "storage", "observations"), { recursive: true, force: true });
  rmSync(join(root, "storage", "synthetic", "redteam"), { recursive: true, force: true });
  const h = await openPglite(pgDir);
  const n = await h.db.query<{ n: number }>("select count(*)::int as n from public.bounties where id = $1", [DEMO.bountyId]);
  await h.close();
  console.log(`local demo state reset at ${pgDir} (demo bounty present: ${n[0]?.n === 1})`);
  console.log("note: example images were kept on disk but their DB link was reset; run generate:examples (or spawn-event) to relink.");
}

async function resetSupabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set (or use LOCAL_BACKEND=1)");
  const { openPostgres } = await import("../lib/db/postgres");
  const pg = openPostgres(url);
  const { seed } = readSchemaFiles(findSupabaseDir());
  await pg.db.tx(async (tx) => {
    for (const t of ["redteam_runs", "ledger_entries", "match_cache", "weather_alerts", "submissions", "capture_sessions", "bounties"]) {
      await tx.query(`delete from public.${t}`);
    }
    await tx.query("delete from public.synthetic_media where kind <> 'example'");
    await tx.query("delete from public.protocols where id <> $1 and not exists (select 1 from public.bounties b where b.protocol_id = protocols.id)", [DEMO.protocolId]);
    await tx.query("update public.profiles set trust_score = 0.5");
  });
  // seed.sql is idempotent (on conflict) and multi-statement: postgres.js runs it via the simple protocol.
  await pg.db.query(seed);
  await pg.close();
  console.log("supabase demo state reset (storage objects were not deleted)");
}

(isLocalBackend() ? resetLocal() : resetSupabase())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
