/**
 * Db singleton. LOCAL_BACKEND=1 → PGlite persisted under apps/web/.local/pglite (PGLITE_DIR
 * overrides; "memory" → in-memory). Otherwise postgres.js on DATABASE_URL.
 * Cached on globalThis so Next dev HMR never opens a second PGlite on the same directory.
 */
import { join, resolve } from "node:path";
import { isLocalBackend } from "../env";
import type { Db } from "./types";

export type { Db } from "./types";

interface DbCache {
  promise: Promise<Db> | null;
  override: Db | null;
}

const g = globalThis as typeof globalThis & { __gtDb?: DbCache };
const cache: DbCache = (g.__gtDb ??= { promise: null, override: null });

export function localDataRoot(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.LOCAL_DATA_DIR || join(process.cwd(), ".local"));
}

async function open(): Promise<Db> {
  if (isLocalBackend()) {
    const { openPglite } = await import("./pglite");
    const dir = process.env.PGLITE_DIR === "memory" ? undefined : resolve(/*turbopackIgnore: true*/ process.env.PGLITE_DIR || join(localDataRoot(), "pglite"));
    return (await openPglite(dir)).db;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (or set LOCAL_BACKEND=1 for the local PGlite backend)");
  const { openPostgres } = await import("./postgres");
  return openPostgres(url).db;
}

export function getDb(): Promise<Db> {
  if (cache.override) return Promise.resolve(cache.override);
  if (!cache.promise) {
    cache.promise = open().catch((err) => {
      cache.promise = null;
      throw err;
    });
  }
  return cache.promise;
}

/** Tests inject a PGlite-backed Db. Pass null to clear. */
export function setDbForTests(db: Db | null): void {
  cache.override = db;
}
