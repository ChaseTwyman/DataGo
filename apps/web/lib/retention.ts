/**
 * Photo retention: photos of rejected submissions are deleted REJECTED_MEDIA_RETENTION_DAYS (default 30)
 * after the decision (reviewed_at, else received_at). The row stays (verification history, duplicate
 * hashes) and gets media_purged_at, which the dashboard shows as "photos deleted per retention policy".
 * Idempotent and batch-limited, so a missed or duplicated daily cron run is harmless.
 */
import type { Db } from "./db";
import type { ObjectStorage } from "./storage";

export function retentionDays(): number {
  const n = Number(process.env.REJECTED_MEDIA_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
}

export interface RetentionResult {
  submissions: number;
  photos: number;
  cutoff: string;
}

export async function purgeRejectedMedia(db: Db, storage: ObjectStorage, opts: { now?: Date; days?: number; batch?: number } = {}): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? retentionDays();
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = await db.query<{ id: string; user_id: string; media: unknown }>(
    `select id, user_id, media from public.submissions
      where status = 'rejected' and media_purged_at is null and coalesce(reviewed_at, received_at) < $1::timestamptz
      order by received_at limit $2`,
    [cutoff, opts.batch ?? 500],
  );
  if (rows.length === 0) return { submissions: 0, photos: 0, cutoff };
  const paths = rows.flatMap((r) =>
    (Array.isArray(r.media) ? (r.media as { path?: unknown }[]) : [])
      .map((m) => m.path)
      // Only the submitter's own folder: a rejected row may reference someone else's photo paths.
      .filter((p): p is string => typeof p === "string" && p.startsWith(`observations/${r.user_id}/`) && !p.includes("..")),
  );
  if (paths.length > 0) await storage.remove(paths);
  await db.query("update public.submissions set media_purged_at = $2::timestamptz where id = any($1::uuid[])", [rows.map((r) => r.id), now.toISOString()]);
  return { submissions: rows.length, photos: paths.length, cutoff };
}
