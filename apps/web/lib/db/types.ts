/**
 * Tiny SQL interface shared by the two drivers (postgres.js against Supabase, PGlite locally).
 * Repositories (lib/db/repos) hold all SQL. Conventions so both drivers behave the same:
 * - jsonb params are passed as JSON strings and cast in SQL (`$1::jsonb`)
 * - timestamps are passed as ISO strings and cast (`$1::timestamptz`)
 * - counts are cast to int (`count(*)::int`) so they come back as JS numbers
 */
export type SqlParam = string | number | boolean | null | string[] | number[];

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Runs `fn` in a transaction; the `Db` passed to `fn` is bound to it. */
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
}

export const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
export const toIsoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : toIso(v));
export const json = (v: unknown): string => JSON.stringify(v);
