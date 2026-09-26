/**
 * DEMO/DEV ONLY: seeds ~40 realistic accepted flood observations into the demo bounty so /data has
 * rows to show. Idempotent (skips if seeded rows exist). Rows are marked device.model = "seed-script"
 * and gate.seeded = true, and are published with is_demo_seed = true.
 *
 *   LOCAL_BACKEND=1 pnpm --filter @groundtruth/web seed:open-data            # local PGlite (stop next dev first)
 *   DEMO_MODE=1 pnpm --filter @groundtruth/web seed:open-data                # Supabase via DATABASE_URL
 *   ... seed:open-data --reset                                               # remove only seeded rows
 *   ... seed:open-data --bounty <uuid> [--count 40]
 */
import { DEMO } from "@groundtruth/shared";
import { isDemoMode, isLocalBackend } from "../lib/env";
import type { Db } from "../lib/db";
import { resetOpenDataSeed, seedOpenData } from "../lib/openDataSeed";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function open(): Promise<{ db: Db; close(): Promise<void>; where: string }> {
  if (isLocalBackend()) {
    const { join, resolve } = await import("node:path");
    const { openPglite } = await import("../lib/db/pglite");
    const root = resolve(process.env.LOCAL_DATA_DIR || join(process.cwd(), ".local"));
    const dir = resolve(process.env.PGLITE_DIR || join(root, "pglite"));
    const h = await openPglite(dir);
    return { db: h.db, close: () => h.close(), where: `PGlite ${dir}` };
  }
  if (!isDemoMode()) throw new Error("Refusing to seed a non-local database without DEMO_MODE=1 (these are demo rows).");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set (or use LOCAL_BACKEND=1)");
  const { openPostgres } = await import("../lib/db/postgres");
  const pg = openPostgres(url);
  return { db: pg.db, close: () => pg.close(), where: "DATABASE_URL" };
}

async function main(): Promise<void> {
  const bountyId = arg("--bounty") ?? DEMO.bountyId;
  const count = arg("--count") ? Number(arg("--count")) : 40;
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error("--count must be 1..500");
  const conn = await open();
  try {
    if (process.argv.includes("--reset")) {
      const removed = await resetOpenDataSeed(conn.db, arg("--bounty"));
      console.log(`[seed-open-data] ${conn.where}: removed ${removed} seeded row(s)`);
      return;
    }
    const r = await seedOpenData(conn.db, { bountyId, count });
    console.log(
      r.skipped
        ? `[seed-open-data] ${conn.where}: bounty ${bountyId} already seeded; nothing to do (use --reset first to re-seed)`
        : `[seed-open-data] ${conn.where}: inserted ${r.inserted} accepted seed observation(s) into bounty ${bountyId}`,
    );
  } finally {
    await conn.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[seed-open-data]", err instanceof Error ? err.message : err);
    process.exit(1);
  });
