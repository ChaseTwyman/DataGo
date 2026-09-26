/**
 * postgres.js driver against the Supabase Postgres connection string (DATABASE_URL). Connects as the
 * database owner, so like the service role it bypasses RLS: every route must do its own auth checks.
 * Never log the URL (it contains the password).
 */
import postgres from "postgres";
import type { Db, SqlParam } from "./types";

type Sql = postgres.Sql | postgres.TransactionSql;

function wrap(sql: Sql, root: postgres.Sql | null): Db {
  const db: Db = {
    async query<T>(text: string, params: SqlParam[] = []) {
      const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
    async tx<R>(fn: (db: Db) => Promise<R>): Promise<R> {
      if (!root) return fn(db);
      const out = await root.begin((t) => fn(wrap(t, null)));
      return out as R;
    },
  };
  return db;
}

/**
 * Normalises a Supabase connection string for postgres.js: drops Prisma-only params (`pgbouncer`,
 * `connection_limit`) that postgres.js would otherwise send to the server as settings (and fail),
 * and decides SSL (required for hosted Supabase; off for localhost).
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
  const { url, ssl } = normalizeDatabaseUrl(rawUrl);
  // prepare:false: Supabase's transaction pooler (port 6543) does not support prepared statements.
  const sql = postgres(url, { max: 5, prepare: false, ssl, idle_timeout: 20, connect_timeout: 10 });
  return { db: wrap(sql, sql), close: () => sql.end({ timeout: 5 }) };
}
