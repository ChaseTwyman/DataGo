/**
 * PGlite driver: in-process Postgres with the real supabase/migrations applied (plus the auth/storage
 * shim). Used by LOCAL_BACKEND=1 and by tests, so tests exercise the real schema, triggers, and
 * helper functions.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { applySupabaseSchema } from "../../../../supabase/test/shim";
import type { Db, SqlParam } from "./types";

/** Finds the repo's `supabase/` dir by walking up from cwd (Next, vitest, and tsx all run in apps/web). */
export function findSupabaseDir(start = process.cwd()): string {
  if (process.env.SUPABASE_DIR) return resolve(process.env.SUPABASE_DIR);
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, "supabase", "migrations");
    if (existsSync(candidate)) return join(dir, "supabase");
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`supabase/migrations not found above ${start}`);
    dir = parent;
  }
}

export function readSchemaFiles(supabaseDir = findSupabaseDir()): { migrations: string[]; seed: string } {
  const migDir = join(supabaseDir, "migrations");
  const migrations = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migDir, f), "utf8"));
  return { migrations, seed: readFileSync(join(supabaseDir, "seed.sql"), "utf8") };
}

type Queryable = Pick<Transaction, "query">;

function wrap(q: Queryable, pg: PGlite | null): Db {
  const db: Db = {
    async query<T>(sql: string, params: SqlParam[] = []) {
      const r = await q.query<T>(sql, params);
      return r.rows;
    },
    async tx<R>(fn: (db: Db) => Promise<R>): Promise<R> {
      // Nested tx on an already-bound transaction just reuses it.
      if (!pg) return fn(db);
      return pg.transaction((t) => fn(wrap(t, null)));
    },
  };
  return db;
}

export interface PgliteHandle {
  db: Db;
  pg: PGlite;
  close(): Promise<void>;
}

/**
 * Opens (and on first use initialises) a PGlite database. `dataDir` undefined → in-memory.
 * A persisted directory is initialised once: migrations run only if `public.profiles` is missing.
 */
export async function openPglite(dataDir?: string): Promise<PgliteHandle> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = dataDir
    ? new PGlite(dataDir, { extensions: { pgcrypto } })
    : new PGlite({ extensions: { pgcrypto } });
  await pg.waitReady;
  const exists = await pg.query<{ t: string | null }>("select to_regclass('public.profiles')::text as t");
  if (!exists.rows[0]?.t) {
    await applySupabaseSchema(pg, readSchemaFiles());
  }
  return { db: wrap(pg, pg), pg, close: () => pg.close() };
}
