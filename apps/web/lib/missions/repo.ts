/** SQL for revisit missions (migration 000010). Server-only table: every read/write goes through here. */
import type { MissionStatus } from "@groundtruth/shared";
import type { Db } from "../db";
import { toIso, toIsoOrNull } from "../db/types";

export interface MissionRow {
  id: string;
  bounty_id: string;
  cell: string;
  source_submission_id: string;
  original_user_id: string | null;
  sequence: number;
  interval_min: number;
  opens_at: string;
  due_at: string;
  dibs_until: string;
  closes_at: string;
  status: MissionStatus;
  filled_submission_id: string | null;
  filled_at: string | null;
  created_at: string;
}

const COLS = `id, bounty_id, cell, source_submission_id, original_user_id, sequence, interval_min, opens_at, due_at,
  dibs_until, closes_at, status, filled_submission_id, filled_at, created_at`;

function map(r: Record<string, unknown>): MissionRow {
  return {
    ...(r as unknown as MissionRow),
    sequence: Number(r.sequence),
    interval_min: Number(r.interval_min),
    opens_at: toIso(r.opens_at),
    due_at: toIso(r.due_at),
    dibs_until: toIso(r.dibs_until),
    closes_at: toIso(r.closes_at),
    filled_at: toIsoOrNull(r.filled_at),
    created_at: toIso(r.created_at),
  };
}

export interface NewMission {
  bounty_id: string;
  cell: string;
  source_submission_id: string;
  original_user_id: string;
  sequence: number;
  interval_min: number;
  opens_at: string;
  due_at: string;
  dibs_until: string;
  closes_at: string;
}

/** Inserts missions; a duplicate (source, sequence) is ignored (idempotent on re-run). */
export async function insertMissions(db: Db, ms: NewMission[]): Promise<number> {
  let n = 0;
  for (const m of ms) {
    const rows = await db.query<{ id: string }>(
      `insert into public.missions (bounty_id, cell, source_submission_id, original_user_id, sequence, interval_min,
         opens_at, due_at, dibs_until, closes_at)
       values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz)
       on conflict (source_submission_id, sequence) do nothing
       returning id`,
      [m.bounty_id, m.cell, m.source_submission_id, m.original_user_id, m.sequence, m.interval_min, m.opens_at, m.due_at, m.dibs_until, m.closes_at],
    );
    n += rows.length;
  }
  return n;
}

/** Open missions whose window has not closed yet (includes upcoming ones), optionally one request/cell. */
export async function openMissions(db: Db, f: { bountyIds?: string[]; bountyId?: string; cell?: string; now: Date }): Promise<MissionRow[]> {
  const where = ["status = 'open'", "closes_at > $1::timestamptz"];
  const params: (string | string[])[] = [f.now.toISOString()];
  if (f.bountyIds) {
    params.push(f.bountyIds);
    where.push(`bounty_id = any($${params.length}::uuid[])`);
  }
  if (f.bountyId) {
    params.push(f.bountyId);
    where.push(`bounty_id = $${params.length}`);
  }
  if (f.cell) {
    params.push(f.cell);
    where.push(`cell = $${params.length}`);
  }
  const rows = await db.query<Record<string, unknown>>(
    `select ${COLS} from public.missions where ${where.join(" and ")} order by opens_at, sequence limit 500`,
    params,
  );
  return rows.map(map);
}

/**
 * Missions a reading captured at `capturedAt` could fill: unfilled, window containing the capture time.
 * Includes "expired" ones (a reading captured in time may be approved by a reviewer after the window).
 */
export async function fillableMissions(db: Db, bountyId: string, cell: string, capturedAt: string): Promise<MissionRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select ${COLS} from public.missions
      where bounty_id = $1 and cell = $2 and status in ('open', 'expired') and filled_submission_id is null
        and opens_at <= $3::timestamptz and closes_at >= $3::timestamptz
      order by sequence`,
    [bountyId, cell, capturedAt],
  );
  return rows.map(map);
}

/** Every mission of a request (researcher view), newest first. */
export async function missionsForBounty(db: Db, bountyId: string, limit = 200): Promise<MissionRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select ${COLS} from public.missions where bounty_id = $1 order by created_at desc, sequence limit $2`,
    [bountyId, limit],
  );
  return rows.map(map);
}

/** Lazily expires missions whose window closed. Returns how many changed. */
export async function expireMissions(db: Db, now: Date): Promise<number> {
  const rows = await db.query<{ id: string }>(
    "update public.missions set status = 'expired' where status = 'open' and closes_at <= $1::timestamptz returning id",
    [now.toISOString()],
  );
  return rows.length;
}

/**
 * Fills a mission with an accepted reading and links the reading to the one that created the
 * mission. Conditional on the mission being unfilled (two concurrent readings can't both fill it; an
 * "expired" one still can, by a reading captured inside its window but approved late) and on the
 * reading not being linked already. Returns false when it lost the race.
 */
export async function fillMission(db: Db, missionId: string, submissionId: string, sourceSubmissionId: string, now: Date): Promise<boolean> {
  return db.tx(async (tx) => {
    const won = await tx.query<{ id: string }>(
      `update public.missions set status = 'filled', filled_submission_id = $2, filled_at = $3::timestamptz
        where id = $1 and status in ('open', 'expired') and filled_submission_id is null
          and not exists (select 1 from public.missions m2 where m2.filled_submission_id = $2)
        returning id`,
      [missionId, submissionId, now.toISOString()],
    );
    if (won.length !== 1) return false;
    await tx.query("update public.submissions set mission_id = $2, revisit_of = $3 where id = $1 and mission_id is null", [
      submissionId,
      missionId,
      sourceSubmissionId,
    ]);
    return true;
  });
}

/** Active (window open now) missions of one request, for pricing. */
export async function activeMissionsByCell(db: Db, bountyId: string, now: Date): Promise<Map<string, Pick<MissionRow, "original_user_id" | "dibs_until">[]>> {
  const rows = await db.query<{ cell: string; original_user_id: string | null; dibs_until: unknown }>(
    `select cell, original_user_id, dibs_until from public.missions
      where bounty_id = $1 and status = 'open' and opens_at <= $2::timestamptz and closes_at > $2::timestamptz`,
    [bountyId, now.toISOString()],
  );
  const out = new Map<string, Pick<MissionRow, "original_user_id" | "dibs_until">[]>();
  for (const r of rows) {
    const list = out.get(r.cell) ?? [];
    list.push({ original_user_id: r.original_user_id, dibs_until: toIso(r.dibs_until) });
    out.set(r.cell, list);
  }
  return out;
}
