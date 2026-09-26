import type { Challenge } from "@groundtruth/shared";
import { json, toIso, type Db } from "../types";

export interface SessionRow {
  id: string;
  bounty_id: string;
  user_id: string;
  nonce: string;
  challenge: Challenge;
  cell: string;
  start_lat: number | null;
  start_lng: number | null;
  price_quote_cents: number;
  quote_expires_at: string;
  started_at: string;
  expires_at: string;
  status: "open" | "submitted" | "expired" | "abandoned";
  frame_checks: number;
  upload_paths: string[];
}

const COLS = `id, bounty_id, user_id, nonce, challenge, cell, start_lat, start_lng, price_quote_cents, quote_expires_at,
  started_at, expires_at, status::text as status, frame_checks, upload_paths`;

function map(r: Record<string, unknown>): SessionRow {
  return {
    ...(r as unknown as SessionRow),
    quote_expires_at: toIso(r.quote_expires_at),
    started_at: toIso(r.started_at),
    expires_at: toIso(r.expires_at),
  };
}

export interface NewSession {
  id: string;
  bounty_id: string;
  user_id: string;
  nonce: string;
  challenge: Challenge;
  cell: string;
  start_lat: number;
  start_lng: number;
  price_quote_cents: number;
  quote_expires_at: string;
  started_at: string;
  expires_at: string;
  upload_paths: string[];
}

export async function insertSession(db: Db, s: NewSession): Promise<void> {
  await db.query(
    `insert into public.capture_sessions (id, bounty_id, user_id, nonce, challenge, cell, start_lat, start_lng, price_quote_cents,
       quote_expires_at, started_at, expires_at, upload_paths)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::timestamptz, $13::text[])`,
    [
      s.id, s.bounty_id, s.user_id, s.nonce, json(s.challenge), s.cell, s.start_lat, s.start_lng, s.price_quote_cents,
      s.quote_expires_at, s.started_at, s.expires_at, s.upload_paths,
    ],
  );
}

export async function getSession(db: Db, id: string): Promise<SessionRow | null> {
  const rows = await db.query<Record<string, unknown>>(`select ${COLS} from public.capture_sessions where id = $1`, [id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function setSessionStatus(db: Db, id: string, status: SessionRow["status"]): Promise<void> {
  await db.query("update public.capture_sessions set status = $2::public.session_status where id = $1", [id, status]);
}

/** Atomically moves an open session to submitted. False if it was not open (double submit). */
export async function markSubmittedIfOpen(db: Db, id: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    "update public.capture_sessions set status = 'submitted' where id = $1 and status = 'open' returning id",
    [id],
  );
  return rows.length === 1;
}

/** Claims the frame-check slot (1 in flight, `limit` per session). Returns checks used, or null. */
export async function claimFrameCheck(db: Db, sessionId: string, userId: string, limit: number, lockSeconds: number): Promise<number | null> {
  const rows = await db.query<{ n: number | null }>("select public.claim_frame_check($1, $2, $3, $4) as n", [
    sessionId, userId, limit, lockSeconds,
  ]);
  return rows[0]?.n ?? null;
}

export async function releaseFrameCheck(db: Db, sessionId: string): Promise<void> {
  await db.query("select public.release_frame_check($1)", [sessionId]);
}

/** Why a claim failed, for a useful error. */
export async function frameCheckState(db: Db, sessionId: string): Promise<{ frame_checks: number; locked: boolean } | null> {
  const rows = await db.query<{ frame_checks: number; locked: boolean }>(
    `select frame_checks, coalesce(frame_check_lock_until > now(), false) as locked from public.capture_sessions where id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}
