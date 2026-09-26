/**
 * Postgres driver against the Supabase connection string (DATABASE_URL). Connects as the database
 * owner, so like the service role it bypasses RLS: every route must do its own auth checks.
 * Never log the URL (it contains the password).
 *
 * Driver: node-postgres (`pg`), not postgres.js. postgres.js pipelines queries on a connection when
 * more queries are in flight than connections; Supabase's transaction pooler (Supavisor, port 6543)
 * does not handle pipelined extended-protocol messages, so under concurrency (the pricing engine
 * runs 6 queries per bounty) statements sat `active / ClientRead` until the 2-minute statement
 * timeout — observed in production as hung and 500ing /nearby and /coverage requests. `pg` checks
 * out one connection per query (or per transaction) and never pipelines. Session mode (5432) was
 * rejected: its 15-client pool_size is exhausted by serverless instances (EMAXCONNSESSION).
 */
import pg from "pg";
import { assertMockGrokAllowed } from "../env";
import type { Db, SqlParam } from "./types";

/** Bounded so a stuck statement fails fast instead of holding a request for minutes. */
export const STATEMENT_TIMEOUT_MS = 30_000;

type Queryable = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> };

function wrap(q: Queryable, pool: pg.Pool | null): Db {
  const db: Db = {
    async query<T>(text: string, params: SqlParam[] = []) {
      const res = await q.query(text, params);
      return res.rows as T[];
    },
    async tx<R>(fn: (db: Db) => Promise<R>): Promise<R> {
      if (!pool) return fn(db); // already inside a transaction
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(wrap(client, null));
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
  return db;
}

/**
 * Repos pass json/jsonb params already stringified (`json()` in ./types). `pg` sends strings as-is
 * (the SQL casts them), so there is no double encoding. Kept exported for the regression test that
 * guarded the earlier postgres.js double-encoding bug.
 */
export const jsonParamSerializer = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x));

/**
 * Normalises a Supabase connection string: drops Prisma-only params (`pgbouncer`,
 * `connection_limit`, `pool_timeout`) and `sslmode` (TLS is decided here: required for hosted
 * Supabase, off for localhost).
 */
export function normalizeDatabaseUrl(url: string): { url: string; ssl: "require" | false } {
  const u = new URL(url);
  for (const p of ["pgbouncer", "connection_limit", "pool_timeout"]) u.searchParams.delete(p);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  const sslParam = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode");
  const ssl = sslParam === "disable" || (local && !sslParam) ? false : "require";
  return { url: u.toString(), ssl };
}

export function openPostgres(rawUrl: string): { db: Db; close(): Promise<void> } {
  // Every path to a real database comes through here (API and scripts): no mock verification on it.
  assertMockGrokAllowed();
  const { url, ssl } = normalizeDatabaseUrl(rawUrl);
  const pool = new pg.Pool({
    connectionString: url,
    // Encrypted like postgres.js `ssl: "require"` (no CA pinning; Supabase's pooler cert chain is
    // not in Node's default store).
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    allowExitOnIdle: true,
  });
  // An idle client dropped by the pooler must not crash the process.
  pool.on("error", (err) => console.warn("[db] idle client error:", err.message));
  return { db: wrap(pool, pool), close: () => pool.end() };
}
