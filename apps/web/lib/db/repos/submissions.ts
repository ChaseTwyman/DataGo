import type {
  DeviceInfo,
  FieldNotes,
  GateInfo,
  MediaItem,
  ReasonCode,
  SensorSnapshot,
  StageResult,
  SubmissionRow,
  SubmissionStatus,
  Verifier,
} from "@groundtruth/shared";
import { json, toIso, type Db } from "../types";

/** Full row incl. server-only columns. `SubmissionRow` (shared contract) is the client subset. */
export interface SubmissionRecord extends SubmissionRow {
  device: DeviceInfo | Record<string, never>;
  sensors: SensorSnapshot | Record<string, never>;
  gate: GateInfo | Record<string, never>;
  phashes: string[];
  retryable: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  /** Who decided: model | mock | human | none (migration 000005). */
  verifier: Verifier;
}

const COLS = `id, session_id, bounty_id, user_id, media, lat, lng, accuracy_m, h3_cell, captured_at, received_at,
  device, sensors, gate, field_notes, status::text as status, checks, reason_codes, confidence, protocol_score,
  authenticity_score, extracted, phashes, payout_cents, retryable, reviewed_by, reviewed_at, review_note, verifier, media_purged_at`;

function map(r: Record<string, unknown>): SubmissionRecord {
  return {
    ...(r as unknown as SubmissionRecord),
    captured_at: toIso(r.captured_at),
    received_at: toIso(r.received_at),
    reviewed_at: r.reviewed_at ? toIso(r.reviewed_at) : null,
    media_purged_at: r.media_purged_at ? toIso(r.media_purged_at) : null,
  };
}

/** Client-facing subset (SubmissionRowSchema). */
export function toSubmissionRow(s: SubmissionRecord): SubmissionRow {
  return {
    id: s.id,
    session_id: s.session_id,
    bounty_id: s.bounty_id,
    user_id: s.user_id,
    media: s.media,
    lat: s.lat,
    lng: s.lng,
    accuracy_m: s.accuracy_m,
    h3_cell: s.h3_cell,
    captured_at: s.captured_at,
    received_at: s.received_at,
    status: s.status,
    checks: s.checks,
    reason_codes: s.reason_codes,
    confidence: s.confidence,
    protocol_score: s.protocol_score,
    authenticity_score: s.authenticity_score,
    extracted: s.extracted,
    field_notes: s.field_notes,
    payout_cents: s.payout_cents,
    media_purged_at: s.media_purged_at ?? null,
  };
}

export interface NewSubmission {
  id?: string;
  session_id: string | null;
  bounty_id: string;
  user_id: string;
  media: MediaItem[];
  lat: number;
  lng: number;
  accuracy_m: number | null;
  h3_cell: string;
  captured_at: string;
  device: DeviceInfo | Record<string, never>;
  sensors: SensorSnapshot | Record<string, never>;
  gate: (GateInfo & { nonce?: string }) | Record<string, never>;
  field_notes: FieldNotes;
  checks: StageResult[];
  status?: SubmissionStatus;
}

export async function insertSubmission(db: Db, s: NewSubmission): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.submissions (id, session_id, bounty_id, user_id, media, lat, lng, accuracy_m, h3_cell, captured_at,
       device, sensors, gate, field_notes, checks, status)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::timestamptz,
       $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::public.submission_status)
     returning id`,
    [
      s.id ?? null, s.session_id, s.bounty_id, s.user_id, json(s.media), s.lat, s.lng, s.accuracy_m, s.h3_cell, s.captured_at,
      json(s.device), json(s.sensors), json(s.gate), json(s.field_notes), json(s.checks), s.status ?? "pending",
    ],
  );
  return rows[0]!.id;
}

export async function getSubmission(db: Db, id: string): Promise<SubmissionRecord | null> {
  const rows = await db.query<Record<string, unknown>>(`select ${COLS} from public.submissions where id = $1`, [id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function listSubmissions(
  db: Db,
  f: { bountyIds: string[] | null; status?: SubmissionStatus; limit: number; bountyId?: string },
): Promise<SubmissionRecord[]> {
  const where: string[] = [];
  const params: (string | number | string[])[] = [];
  if (f.bountyIds) {
    params.push(f.bountyIds);
    where.push(`bounty_id = any($${params.length}::uuid[])`);
  }
  if (f.bountyId) {
    params.push(f.bountyId);
    where.push(`bounty_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`status = $${params.length}::public.submission_status`);
  }
  params.push(f.limit);
  const rows = await db.query<Record<string, unknown>>(
    `select ${COLS} from public.submissions ${where.length ? `where ${where.join(" and ")}` : ""}
      order by received_at desc limit $${params.length}`,
    params,
  );
  return rows.map(map);
}

export async function latestForSession(db: Db, sessionId: string): Promise<SubmissionRecord | null> {
  const rows = await db.query<Record<string, unknown>>(
    `select ${COLS} from public.submissions where session_id = $1 order by received_at desc limit 1`,
    [sessionId],
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function setChecks(db: Db, id: string, checks: StageResult[], status?: SubmissionStatus): Promise<void> {
  if (status) {
    await db.query("update public.submissions set checks = $2::jsonb, status = $3::public.submission_status where id = $1", [
      id, json(checks), status,
    ]);
  } else {
    await db.query("update public.submissions set checks = $2::jsonb where id = $1", [id, json(checks)]);
  }
}

export interface FinalFields {
  status: SubmissionStatus;
  checks: StageResult[];
  reason_codes: ReasonCode[];
  confidence: number;
  protocol_score: number | null;
  authenticity_score: number | null;
  extracted: Record<string, unknown> | null;
  phashes: string[];
  payout_cents: number;
  retryable: boolean;
  /** Required so every writer states who decided (mock/none rows are never exported or published). */
  verifier: Verifier;
}

export async function finalizeSubmission(db: Db, id: string, f: FinalFields): Promise<void> {
  await db.query(
    `update public.submissions set status = $2::public.submission_status, checks = $3::jsonb, reason_codes = $4::text[],
       confidence = $5, protocol_score = $6, authenticity_score = $7, extracted = $8::jsonb, phashes = $9::text[],
       payout_cents = $10, retryable = $11, verifier = $12
     where id = $1`,
    [
      id, f.status, json(f.checks), f.reason_codes, f.confidence, f.protocol_score, f.authenticity_score,
      f.extracted === null ? null : json(f.extracted), f.phashes, f.payout_cents, f.retryable, f.verifier,
    ],
  );
}

export async function setReviewOutcome(
  db: Db,
  id: string,
  o: { status: SubmissionStatus; reason_codes: ReasonCode[]; payout_cents: number; reviewer: string; note: string | null },
): Promise<boolean> {
  // Conditional on needs_review so concurrent reviews cannot both apply (same pattern as markSubmittedIfOpen).
  // A human now decided, except mock/none rows stay unpublishable (verifierAfterReview in shared).
  const rows = await db.query<{ id: string }>(
    `update public.submissions set status = $2::public.submission_status, reason_codes = $3::text[], payout_cents = $4,
       reviewed_by = $5, reviewed_at = now(), review_note = $6, retryable = false,
       verifier = case when verifier in ('mock', 'none') then verifier else 'human' end
     where id = $1 and status = 'needs_review' returning id`,
    [id, o.status, o.reason_codes, o.payout_cents, o.reviewer, o.note],
  );
  return rows.length === 1;
}

// ---------- pipeline lookups ----------

/** Every stored perceptual hash except this submission's. */
export async function priorHashes(db: Db, excludeId: string | null): Promise<{ id: string; phashes: string[] }[]> {
  return db.query<{ id: string; phashes: string[] }>(
    `select id, phashes from public.submissions where cardinality(phashes) > 0 and ($1::uuid is null or id <> $1::uuid)`,
    [excludeId],
  );
}

export async function countUserCellSince(db: Db, userId: string, cell: string, sinceIso: string, excludeId: string | null): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from public.submissions
      where user_id = $1 and h3_cell = $2 and captured_at >= $3::timestamptz and ($4::uuid is null or id <> $4::uuid)`,
    [userId, cell, sinceIso, excludeId],
  );
  return rows[0]?.n ?? 0;
}

/** The user's most recent other submission captured at or before `beforeIso`. */
export async function previousUserSubmission(
  db: Db,
  userId: string,
  beforeIso: string,
  excludeId: string | null,
): Promise<{ lat: number; lng: number; captured_at: string } | null> {
  const rows = await db.query<{ lat: number; lng: number; captured_at: unknown }>(
    `select lat, lng, captured_at from public.submissions
      where user_id = $1 and captured_at <= $2::timestamptz and ($3::uuid is null or id <> $3::uuid)
      order by captured_at desc limit 1`,
    [userId, beforeIso, excludeId],
  );
  const r = rows[0];
  return r ? { lat: r.lat, lng: r.lng, captured_at: toIso(r.captured_at) } : null;
}

/**
 * Accepted observations of the bounty within ±window of `atIso` (distance filtered by the caller).
 * Unverified (seed) and mock-verified rows never corroborate a real capture.
 */
export async function acceptedNear(
  db: Db,
  bountyId: string,
  atIso: string,
  windowMin: number,
  excludeId: string | null,
): Promise<{ id: string; lat: number; lng: number; extracted: Record<string, unknown> | null }[]> {
  return db.query(
    `select id, lat, lng, extracted from public.submissions
      where bounty_id = $1 and status = 'accepted' and verifier not in ('mock', 'none')
        and captured_at between $2::timestamptz - make_interval(mins => $3) and $2::timestamptz + make_interval(mins => $3)
        and ($4::uuid is null or id <> $4::uuid)`,
    [bountyId, atIso, windowMin, excludeId],
  );
}

export async function latestAccepted(db: Db, bountyId: string | null): Promise<SubmissionRecord | null> {
  const rows = await db.query<Record<string, unknown>>(
    `select ${COLS} from public.submissions where status = 'accepted' and ($1::uuid is null or bounty_id = $1::uuid)
      order by received_at desc limit 1`,
    [bountyId],
  );
  return rows[0] ? map(rows[0]) : null;
}
