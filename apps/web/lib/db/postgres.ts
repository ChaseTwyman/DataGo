/**
 * postgres.js driver against the Supabase Postgres connection string (DATABASE_URL). Connects as the
 * database owner, so like the service role it bypasses RLS: every route must do its own auth checks.
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

export function openPostgres(url: string): { db: Db; close(): Promise<void> } {
  // prepare:false keeps it compatible with Supabase's transaction pooler (port 6543).
  const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  return { db: wrap(sql, sql), close: () => sql.end({ timeout: 5 }) };
}
