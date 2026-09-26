/**
 * grokbot_cache (migration 000008): generated text keyed by (kind, subject, audience, version).
 * `version` hashes the case file, so any change to the underlying facts is a cache miss; stale rows
 * are never read (they expire, and the daily retention cron deletes them).
 */
import { createHash } from "node:crypto";
import type { Db } from "../db";
import type { Audience, CaseFile } from "./types";

export function caseVersion(c: Pick<CaseFile, "facts" | "untrusted">, extra = ""): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(c.facts.map((f) => [f.id, f.text])));
  h.update(JSON.stringify(c.untrusted.map((u) => [u.source, u.text, u.flagged])));
  h.update(extra);
  return h.digest("hex").slice(0, 32);
}

export interface CacheKey {
  kind: string;
  subjectId: string;
  audience: Audience;
  version: string;
}

export async function cacheGet<T>(db: Db, k: CacheKey): Promise<T | null> {
  const rows = await db.query<{ payload: unknown }>(
    `select payload from public.grokbot_cache
      where kind = $1 and subject_id = $2 and audience = $3 and version = $4 and expires_at > now()`,
    [k.kind, k.subjectId, k.audience, k.version],
  );
  const p = rows[0]?.payload;
  if (p === undefined || p === null) return null;
  return (typeof p === "string" ? JSON.parse(p) : p) as T;
}

export async function cachePut(db: Db, k: CacheKey, payload: unknown, source: "grok" | "template", ttlSeconds: number): Promise<void> {
  await db.query(
    `insert into public.grokbot_cache (kind, subject_id, audience, version, payload, source, expires_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, now() + make_interval(secs => $7))
     on conflict (kind, subject_id, audience, version)
     do update set payload = excluded.payload, source = excluded.source, created_at = now(), expires_at = excluded.expires_at`,
    [k.kind, k.subjectId, k.audience, k.version, JSON.stringify(payload), source, ttlSeconds],
  );
}

/** Latest unexpired payload for a subject regardless of version (public pages: never call Grok). */
export async function cacheLatest<T>(db: Db, kind: string, subjectId: string, audience: Audience): Promise<T | null> {
  const rows = await db.query<{ payload: unknown }>(
    `select payload from public.grokbot_cache where kind = $1 and subject_id = $2 and audience = $3 and expires_at > now()
      order by created_at desc limit 1`,
    [kind, subjectId, audience],
  );
  const p = rows[0]?.payload;
  if (p === undefined || p === null) return null;
  return (typeof p === "string" ? JSON.parse(p) : p) as T;
}

export async function pruneGrokbotCache(db: Db): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "with d as (delete from public.grokbot_cache where expires_at < now() returning 1) select count(*)::int as n from d",
  );
  return rows[0]?.n ?? 0;
}
