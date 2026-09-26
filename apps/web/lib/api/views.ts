/** Builders for response payloads shared by several routes. */
import type { BountyDetail, BountyFunding, SubmissionWithMedia } from "@groundtruth/shared";
import type { Db } from "../db";
import type { BountyRow } from "../db/repos/bounties";
import { fundingSources } from "../db/repos/funding";
import { estimateNeedCents } from "../funding/allocation";
import { earmarkLabel, paceLabel } from "../funding/labels";
import { publicCell } from "../pricing/engine";
import { loadPricing, type Pricing } from "../pricing/market";
import type { ProtocolRow } from "../db/repos/protocols";
import { toSubmissionRow, type SubmissionRecord } from "../db/repos/submissions";
import { getStorage } from "../storage";
import { redactedPathFor } from "../image/redact";
import { ownObservationPath } from "../verification/redaction";

export async function mediaUrl(path: string | null, origin: string, ttl = 3600): Promise<string | null> {
  if (!path) return null;
  try {
    return await getStorage().signedRead(path, origin, ttl);
  } catch (err) {
    console.warn("[api] signed read failed", path, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Owner/admin funding panel. */
export async function bountyFunding(db: Db, b: BountyRow, p: ProtocolRow, pricing: Pricing, now = new Date()): Promise<BountyFunding> {
  const sources = await fundingSources(db, b.id);
  return {
    allocation_cents: b.budget_cents,
    spent_cents: b.spent_cents,
    committed_cents: pricing.committedCents,
    remaining_cents: pricing.remainingCents,
    funded_at: b.funded_at,
    funding_reason: b.funding_reason,
    estimated_need_cents: estimateNeedCents({ cells: b.cells.length, targetPerCell: b.target_per_cell, protocol: p.definition }),
    sources: sources.map((s) => ({
      sponsor_name: s.sponsor_name ?? "GroundTruth sponsor pool",
      earmark: earmarkLabel(s.contribution),
      amount_cents: s.cents,
    })),
    pace: paceLabel(b.budget_cents, b.spent_cents + pricing.committedCents, b.starts_at, b.ends_at, now),
    base_cents: pricing.rate.baseCents,
    ceiling_cents: pricing.rate.ceilingCents,
  };
}

export async function bountyDetail(
  db: Db,
  b: BountyRow,
  p: ProtocolRow,
  origin: string,
  opts: { manage: boolean },
  now = new Date(),
): Promise<BountyDetail> {
  const pricing = await loadPricing(db, b, p.definition, now);
  const coverage = pricing.cells.map(publicCell);
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
    // Platform prices: the protocol's current base rate and ceiling, not stored researcher values.
    base_price_cents: pricing.rate.baseCents,
    max_price_cents: pricing.rate.ceilingCents,
    target_per_cell: b.target_per_cell,
    priority: b.priority,
    budget_cents: b.budget_cents,
    spent_cents: b.spent_cents,
    example_image_url: await mediaUrl(p.example_image_path, origin, 24 * 3600),
    briefing_video_url: await mediaUrl(b.briefing_video_path, origin, 24 * 3600),
    sponsor_name: b.sponsor_name,
    sponsor_url: b.sponsor_url,
    coverage,
    justification: b.justification,
    funding: opts.manage ? await bountyFunding(db, b, p, pricing, now) : null,
  };
}

export interface MediaViewer {
  id: string;
  isAdmin: boolean;
}

/**
 * The redacted derivative of a stored frame, or null when there is none yet (pending / failed) or the
 * row's redacted_path is not the one the redaction job writes for this frame (defence in depth: the
 * path must be the sibling `<n>.redacted.jpg` of the contributor's own original).
 */
export function redactedPathOf(s: Pick<SubmissionRecord, "user_id" | "redaction">, m: { path: string; redacted_path?: string | undefined }): string | null {
  if (s.redaction?.status !== "done" || !m.redacted_path) return null;
  if (!ownObservationPath(m.path, s.user_id) || m.redacted_path !== redactedPathFor(m.path)) return null;
  return m.redacted_path;
}

/**
 * Who sees which photos:
 * - the contributor who took them: their originals;
 * - everyone else (researchers, admins): the face/plate-redacted derivatives, "" while redaction is
 *   pending or failed (fail closed: never an original instead);
 * - admins additionally get `original_media_urls` for audit and review.
 */
export async function submissionWithMedia(
  s: SubmissionRecord,
  origin: string,
  bountyTitle: string | null,
  viewer: MediaViewer,
): Promise<SubmissionWithMedia> {
  const owner = viewer.id === s.user_id;
  const sign = (p: string | null) => mediaUrl(p, origin).then((u) => u ?? "");
  // Purged photos (retention / account deletion) no longer exist: no URLs, same array length.
  const purged = !!s.media_purged_at;
  const urls = purged ? s.media.map(() => "") : await Promise.all(s.media.map((m) => sign(owner ? m.path : redactedPathOf(s, m))));
  const originals = viewer.isAdmin && !owner ? (purged ? s.media.map(() => "") : await Promise.all(s.media.map((m) => sign(m.path)))) : undefined;
  return {
    ...toSubmissionRow(s),
    media_urls: urls,
    media_variant: owner ? "original" : "redacted",
    ...(originals ? { original_media_urls: originals } : {}),
    retryable: s.retryable,
    bounty_title: bountyTitle,
    verifier: s.verifier,
  };
}

/** A photo reference shown to a researcher outside a submission (e.g. a red-team "recycled" run). */
export async function researcherMediaUrl(path: string | null, origin: string, viewer: { isAdmin: boolean }): Promise<string | null> {
  if (!path) return null;
  if (!path.startsWith("observations/") || viewer.isAdmin) return mediaUrl(path, origin);
  return mediaUrl(redactedPathFor(path), origin);
}
