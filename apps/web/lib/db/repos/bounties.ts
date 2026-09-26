import type { BountyStatus, GeoJSONPolygon, PatchBountyRequest } from "@groundtruth/shared";
import { json, toIso, toIsoOrNull, type Db } from "../types";

export interface BountyRow {
  id: string;
  protocol_id: string;
  created_by: string | null;
  title: string;
  summary: string;
  area: GeoJSONPolygon;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  h3_res: number;
  cells: string[];
  starts_at: string;
  ends_at: string;
  event_started_at: string | null;
  base_price_cents: number;
  max_price_cents: number;
  target_per_cell: number;
  priority: number;
  budget_cents: number;
  spent_cents: number;
  status: BountyStatus;
  source: "manual" | "nws" | "radar" | "demo";
  briefing_video_path: string | null;
  sponsor_name: string | null;
  sponsor_url: string | null;
  created_at: string;
  /** Sponsor-pool request fields (migration 000007). */
  justification: string | null;
  funding_reason: string | null;
  funded_at: string | null;
}

const COLS = `id, protocol_id, created_by, title, summary, area, center_lat, center_lng, radius_m, h3_res, cells,
  starts_at, ends_at, event_started_at, base_price_cents, max_price_cents, target_per_cell, priority,
  budget_cents, spent_cents, status::text as status, source::text as source, briefing_video_path, sponsor_name, sponsor_url, created_at,
  justification, funding_reason, funded_at`;

type Raw = Record<string, unknown>;

function map(r: Raw): BountyRow {
  return {
    ...(r as unknown as BountyRow),
    starts_at: toIso(r.starts_at),
    ends_at: toIso(r.ends_at),
    event_started_at: toIsoOrNull(r.event_started_at),
    created_at: toIso(r.created_at),
    justification: (r.justification as string | null) ?? null,
    funding_reason: (r.funding_reason as string | null) ?? null,
    funded_at: toIsoOrNull(r.funded_at),
  };
}

export async function getBounty(db: Db, id: string): Promise<BountyRow | null> {
  const rows = await db.query<Raw>(`select ${COLS} from public.bounties where id = $1`, [id]);
  return rows[0] ? map(rows[0]) : null;
}

/** Active bounties whose window contains `now`. */
export async function listActiveBounties(db: Db, now: Date): Promise<BountyRow[]> {
  const rows = await db.query<Raw>(
    `select ${COLS} from public.bounties where status = 'active' and starts_at <= $1::timestamptz and ends_at > $1::timestamptz`,
    [now.toISOString()],
  );
  return rows.map(map);
}

export interface BountyListRow extends BountyRow {
  protocol_slug: string;
  protocol_name: string;
  accepted: number;
  pending_review: number;
}

export async function listBountiesFor(db: Db, userId: string, isAdmin: boolean): Promise<BountyListRow[]> {
  const rows = await db.query<Raw>(
    `select ${COLS.replace(/(^|,\s*)(\w+)/g, "$1b.$2")},
            p.slug as protocol_slug, p.name as protocol_name,
            (select count(*)::int from public.submissions s where s.bounty_id = b.id and s.status = 'accepted') as accepted,
            (select count(*)::int from public.submissions s where s.bounty_id = b.id and s.status = 'needs_review') as pending_review
       from public.bounties b join public.protocols p on p.id = b.protocol_id
      where b.created_by = $1 or $2::boolean
      order by b.created_at desc`,
    [userId, isAdmin],
  );
  return rows.map((r) => ({
    ...map(r),
    protocol_slug: String(r.protocol_slug),
    protocol_name: String(r.protocol_name),
    accepted: Number(r.accepted),
    pending_review: Number(r.pending_review),
  }));
}

export interface NewBounty {
  protocol_id: string;
  created_by: string;
  title: string;
  summary: string;
  area: GeoJSONPolygon;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  cells: string[];
  starts_at: string;
  ends_at: string;
  event_started_at: string | null;
  base_price_cents: number;
  max_price_cents: number;
  target_per_cell: number;
  priority: number;
  budget_cents: number;
  status: BountyStatus;
  source: "manual" | "nws" | "radar" | "demo";
  sponsor_name?: string | null;
  sponsor_url?: string | null;
  justification?: string | null;
}

export async function insertBounty(db: Db, b: NewBounty): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.bounties (protocol_id, created_by, title, summary, area, center_lat, center_lng, radius_m, h3_res, cells,
       starts_at, ends_at, event_started_at, base_price_cents, max_price_cents, target_per_cell, priority, budget_cents, status, source,
       sponsor_name, sponsor_url, justification)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 9, $9::text[], $10::timestamptz, $11::timestamptz, $12::timestamptz,
             $13, $14, $15, $16, $17, $18::public.bounty_status, $19::public.bounty_source, $20, $21, $22)
     returning id`,
    [
      b.protocol_id, b.created_by, b.title, b.summary, json(b.area), b.center_lat, b.center_lng, b.radius_m, b.cells,
      b.starts_at, b.ends_at, b.event_started_at, b.base_price_cents, b.max_price_cents, b.target_per_cell, b.priority,
      b.budget_cents, b.status, b.source, b.sponsor_name ?? null, b.sponsor_url ?? null, b.justification ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function patchBounty(db: Db, id: string, p: PatchBountyRequest): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [id];
  const add = (col: string, val: string | number | null, cast = "") => {
    params.push(val);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (p.title !== undefined) add("title", p.title);
  if (p.summary !== undefined) add("summary", p.summary);
  if (p.status !== undefined) add("status", p.status, "::public.bounty_status");
  if (p.ends_at !== undefined) add("ends_at", p.ends_at, "::timestamptz");
  if (p.base_price_cents !== undefined) add("base_price_cents", p.base_price_cents);
  if (p.max_price_cents !== undefined) add("max_price_cents", p.max_price_cents);
  if (p.target_per_cell !== undefined) add("target_per_cell", p.target_per_cell);
  if (p.priority !== undefined) add("priority", p.priority);
  if (p.budget_cents !== undefined) add("budget_cents", p.budget_cents);
  if (p.sponsor_name !== undefined) add("sponsor_name", p.sponsor_name?.trim() || null);
  if (p.sponsor_url !== undefined) add("sponsor_url", p.sponsor_url);
  if (sets.length === 0) return;
  await db.query(`update public.bounties set ${sets.join(", ")} where id = $1`, params);
}

/** Accepted submissions per H3 cell for one bounty. */
export async function acceptedByCell(db: Db, bountyId: string): Promise<Map<string, number>> {
  const rows = await db.query<{ h3_cell: string; n: number }>(
    `select h3_cell, count(*)::int as n from public.submissions where bounty_id = $1 and status = 'accepted' group by h3_cell`,
    [bountyId],
  );
  return new Map(rows.map((r) => [r.h3_cell, r.n]));
}

/** Atomic budget spend (DB function). False when it would exceed the budget. */
export async function spendBudget(db: Db, bountyId: string, cents: number): Promise<boolean> {
  const rows = await db.query<{ ok: boolean }>("select public.spend_bounty_budget($1, $2) as ok", [bountyId, cents]);
  return rows[0]?.ok === true;
}
