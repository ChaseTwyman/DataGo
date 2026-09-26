/** Builders for response payloads shared by several routes. */
import type { BountyDetail, SubmissionWithMedia } from "@groundtruth/shared";
import { loadCoverage } from "../coverage";
import type { Db } from "../db";
import type { BountyRow } from "../db/repos/bounties";
import type { ProtocolRow } from "../db/repos/protocols";
import { toSubmissionRow, type SubmissionRecord } from "../db/repos/submissions";
import { getStorage } from "../storage";

export async function mediaUrl(path: string | null, origin: string, ttl = 3600): Promise<string | null> {
  if (!path) return null;
  try {
    return await getStorage().signedRead(path, origin, ttl);
  } catch (err) {
    console.warn("[api] signed read failed", path, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function bountyDetail(db: Db, b: BountyRow, p: ProtocolRow, origin: string, now = new Date()): Promise<BountyDetail> {
  const coverage = await loadCoverage(db, b, p.definition, now);
  return {
    id: b.id,
    title: b.title,
    summary: b.summary,
    status: b.status,
    source: b.source,
    protocol_id: b.protocol_id,
    protocol: p.definition,
    area: b.area,
    center_lat: b.center_lat,
    center_lng: b.center_lng,
    radius_m: b.radius_m,
    cells: b.cells,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    event_started_at: b.event_started_at,
    base_price_cents: b.base_price_cents,
    max_price_cents: b.max_price_cents,
    target_per_cell: b.target_per_cell,
    priority: b.priority,
    budget_cents: b.budget_cents,
    spent_cents: b.spent_cents,
    example_image_url: await mediaUrl(p.example_image_path, origin, 24 * 3600),
    briefing_video_url: await mediaUrl(b.briefing_video_path, origin, 24 * 3600),
    sponsor_name: b.sponsor_name,
    sponsor_url: b.sponsor_url,
    coverage,
  };
}

export async function submissionWithMedia(s: SubmissionRecord, origin: string, bountyTitle: string | null): Promise<SubmissionWithMedia> {
  // Purged photos (retention / account deletion) no longer exist: no URLs, same array length.
  const urls = s.media_purged_at ? s.media.map(() => null) : await Promise.all(s.media.map((m) => mediaUrl(m.path, origin)));
  return {
    ...toSubmissionRow(s),
    media_urls: urls.map((u) => u ?? ""),
    retryable: s.retryable,
    bounty_title: bountyTitle,
    verifier: s.verifier,
  };
}
