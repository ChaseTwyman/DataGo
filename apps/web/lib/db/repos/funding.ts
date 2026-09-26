/**
 * Sponsor pool SQL (migration 000007). Ledgers are append-only; every money movement goes through
 * the DB functions (pool_allocate, pool_reverse_contribution, pool_record_external_funding), which
 * take one advisory lock and check availability in the same transaction.
 */
import type { GeoJSONPolygon } from "@groundtruth/shared";
import { json, toIso, type Db } from "../types";

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);

// ---------------------------------------------------------------- sponsors

export interface SponsorRow {
  id: string;
  name: string;
  url: string | null;
  logo_url: string | null;
  active: boolean;
  created_at: string;
  contributed_cents: number;
}

const SPONSOR_COLS = `s.id, s.name, s.url, s.logo_url, s.active, s.created_at,
  coalesce((select sum(case when c.kind = 'contribution' then c.amount_cents else -c.amount_cents end)
              from public.sponsor_contributions c where c.sponsor_id = s.id), 0)::bigint as contributed_cents`;

const mapSponsor = (r: Raw): SponsorRow => ({
  id: String(r.id),
  name: String(r.name),
  url: (r.url as string | null) ?? null,
  logo_url: (r.logo_url as string | null) ?? null,
  active: r.active === true,
  created_at: toIso(r.created_at),
  contributed_cents: num(r.contributed_cents),
});

export async function listSponsors(db: Db): Promise<SponsorRow[]> {
  const rows = await db.query<Raw>(`select ${SPONSOR_COLS} from public.sponsors s order by lower(s.name)`);
  return rows.map(mapSponsor);
}

export async function getSponsor(db: Db, id: string): Promise<SponsorRow | null> {
  const rows = await db.query<Raw>(`select ${SPONSOR_COLS} from public.sponsors s where s.id = $1`, [id]);
  return rows[0] ? mapSponsor(rows[0]) : null;
}

export async function sponsorNameTaken(db: Db, name: string, exceptId: string | null = null): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    "select id from public.sponsors where lower(btrim(name)) = lower(btrim($1)) and ($2::uuid is null or id <> $2::uuid)",
    [name, exceptId],
  );
  return rows.length > 0;
}

export async function insertSponsor(
  db: Db,
  s: { name: string; url: string | null; logo_url: string | null; active: boolean },
  actor: string,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.sponsors (name, url, logo_url, active, created_by) values ($1, $2, $3, $4, $5) returning id",
    [s.name.trim(), s.url, s.logo_url, s.active, actor],
  );
  return rows[0]!.id;
}

export async function patchSponsor(
  db: Db,
  id: string,
  p: { name?: string; url?: string | null; logo_url?: string | null; active?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const params: (string | boolean | null)[] = [id];
  const add = (col: string, v: string | boolean | null) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (p.name !== undefined) add("name", p.name.trim());
  if (p.url !== undefined) add("url", p.url);
  if (p.logo_url !== undefined) add("logo_url", p.logo_url);
  if (p.active !== undefined) add("active", p.active);
  if (sets.length === 0) return;
  await db.query(`update public.sponsors set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
}

// ---------------------------------------------------------------- contributions

export interface ContributionRow {
  id: string;
  sponsor_id: string;
  sponsor_name: string;
  sponsor_url: string | null;
  kind: "contribution" | "reversal";
  amount_cents: number;
  reverses_id: string | null;
  protocol_slug: string | null;
  region_center_lat: number | null;
  region_center_lng: number | null;
  region_radius_m: number | null;
  region_polygon: GeoJSONPolygon | null;
  bounty_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

const CONTRIB_COLS = `c.id, c.sponsor_id, s.name as sponsor_name, s.url as sponsor_url, c.kind, c.amount_cents, c.reverses_id,
  c.protocol_slug, c.region_center_lat, c.region_center_lng, c.region_radius_m, c.region_polygon, c.bounty_id, c.note,
  c.created_by, c.created_at`;

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const mapContribution = (r: Raw): ContributionRow => ({
  id: String(r.id),
  sponsor_id: String(r.sponsor_id),
  sponsor_name: String(r.sponsor_name),
  sponsor_url: (r.sponsor_url as string | null) ?? null,
  kind: r.kind === "reversal" ? "reversal" : "contribution",
  amount_cents: num(r.amount_cents),
  reverses_id: (r.reverses_id as string | null) ?? null,
  protocol_slug: (r.protocol_slug as string | null) ?? null,
  region_center_lat: numOrNull(r.region_center_lat),
  region_center_lng: numOrNull(r.region_center_lng),
  region_radius_m: numOrNull(r.region_radius_m),
  region_polygon: (r.region_polygon as GeoJSONPolygon | null) ?? null,
  bounty_id: (r.bounty_id as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  created_by: (r.created_by as string | null) ?? null,
  created_at: toIso(r.created_at),
});

export const isEarmarked = (c: Pick<ContributionRow, "protocol_slug" | "bounty_id" | "region_center_lat" | "region_polygon">): boolean =>
  c.protocol_slug !== null || c.bounty_id !== null || c.region_center_lat !== null || c.region_polygon !== null;

export interface NewContribution {
  sponsor_id: string;
  amount_cents: number;
  protocol_slug: string | null;
  region_center_lat: number | null;
  region_center_lng: number | null;
  region_radius_m: number | null;
  region_polygon: GeoJSONPolygon | null;
  bounty_id: string | null;
  note: string | null;
}

export async function insertContribution(db: Db, c: NewContribution, actor: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.sponsor_contributions (sponsor_id, amount_cents, protocol_slug, region_center_lat, region_center_lng,
       region_radius_m, region_polygon, bounty_id, note, created_by)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10) returning id`,
    [
      c.sponsor_id, c.amount_cents, c.protocol_slug, c.region_center_lat, c.region_center_lng, c.region_radius_m,
      c.region_polygon ? json(c.region_polygon) : null, c.bounty_id, c.note, actor,
    ],
  );
  return rows[0]!.id;
}

export async function getContribution(db: Db, id: string): Promise<ContributionRow | null> {
  const rows = await db.query<Raw>(
    `select ${CONTRIB_COLS} from public.sponsor_contributions c join public.sponsors s on s.id = c.sponsor_id where c.id = $1`,
    [id],
  );
  return rows[0] ? mapContribution(rows[0]) : null;
}

export async function listContributions(db: Db, limit = 100): Promise<ContributionRow[]> {
  const rows = await db.query<Raw>(
    `select ${CONTRIB_COLS} from public.sponsor_contributions c join public.sponsors s on s.id = c.sponsor_id
      order by c.created_at desc, c.id limit $1`,
    [limit],
  );
  return rows.map(mapContribution);
}

/** Reversal id, or null when refused (more than the unallocated remainder, or already reversed). */
export async function reverseContribution(db: Db, id: string, cents: number, note: string, actor: string): Promise<string | null> {
  const rows = await db.query<{ id: string | null }>("select public.pool_reverse_contribution($1, $2, $3, $4) as id", [id, cents, note, actor]);
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------- buckets

export interface BucketRow {
  /** null = general pool */
  contribution_id: string | null;
  contributed_cents: number;
  allocated_cents: number;
  paid_cents: number;
  available_cents: number;
}

export async function poolBuckets(db: Db): Promise<BucketRow[]> {
  const rows = await db.query<Raw>(
    `select contribution_id, contributed_cents, allocated_cents, paid_cents, available_cents from public.pool_buckets
      order by contribution_id nulls first`,
  );
  return rows.map((r) => ({
    contribution_id: (r.contribution_id as string | null) ?? null,
    contributed_cents: num(r.contributed_cents),
    allocated_cents: num(r.allocated_cents),
    paid_cents: num(r.paid_cents),
    available_cents: num(r.available_cents),
  }));
}

/** Totals across every bucket. paid = exact spend of pool-backed requests (not the floored split). */
export async function poolTotals(db: Db): Promise<{ contributed_cents: number; allocated_cents: number; paid_cents: number; available_cents: number }> {
  const rows = await db.query<Raw>(
    `select
       coalesce((select sum(case when kind = 'contribution' then amount_cents else -amount_cents end) from public.sponsor_contributions), 0)::bigint as contributed,
       coalesce((select sum(amount_cents) from public.pool_allocations), 0)::bigint as allocated,
       coalesce((select sum(b.spent_cents) from public.bounties b where exists (select 1 from public.pool_allocations a where a.bounty_id = b.id)), 0)::bigint as paid`,
  );
  const r = rows[0] ?? {};
  const contributed = num(r.contributed);
  const allocated = num(r.allocated);
  return { contributed_cents: contributed, allocated_cents: allocated, paid_cents: num(r.paid), available_cents: contributed - allocated };
}

/** Earmarked contributions that still have unallocated money, oldest first. */
export async function openEarmarks(db: Db): Promise<(ContributionRow & { available_cents: number })[]> {
  const rows = await db.query<Raw>(
    `select ${CONTRIB_COLS}, pb.available_cents
       from public.pool_buckets pb
       join public.sponsor_contributions c on c.id = pb.contribution_id
       join public.sponsors s on s.id = c.sponsor_id
      where pb.contribution_id is not null and pb.available_cents > 0
      order by c.created_at, c.id`,
  );
  return rows.map((r) => ({ ...mapContribution(r), available_cents: num(r.available_cents) }));
}

export async function bucketAvailable(db: Db, contributionId: string | null): Promise<number> {
  const rows = await db.query<{ n: unknown }>("select public.pool_bucket_available($1) as n", [contributionId]);
  return num(rows[0]?.n);
}

// ---------------------------------------------------------------- allocations

export type AllocationKind = "allocate" | "adjust" | "release";

/** Moves money between a bucket and a request (negative = release). False when refused. */
export async function poolAllocate(
  db: Db,
  a: { bountyId: string; contributionId: string | null; cents: number; kind: AllocationKind; reason: string; actor: string | null },
): Promise<boolean> {
  const rows = await db.query<{ ok: boolean }>("select public.pool_allocate($1, $2, $3, $4, $5, $6) as ok", [
    a.bountyId, a.contributionId, a.cents, a.kind, a.reason.slice(0, 500), a.actor,
  ]);
  return rows[0]?.ok === true;
}

/** Records budget that exists outside the pool (demo events) as an earmarked contribution. */
export async function recordExternalFunding(db: Db, bountyId: string, sponsorName: string | null, sponsorUrl: string | null, note: string): Promise<number> {
  const rows = await db.query<{ n: number }>("select public.pool_record_external_funding($1, $2, $3, $4) as n", [bountyId, sponsorName, sponsorUrl, note]);
  return num(rows[0]?.n);
}

export async function backfillLegacy(db: Db): Promise<number> {
  const rows = await db.query<{ n: number }>("select public.pool_backfill_legacy() as n");
  return num(rows[0]?.n);
}

/** Net allocation per bucket for one request (only buckets still holding money). */
export async function heldByBucket(db: Db, bountyId: string): Promise<{ contribution_id: string | null; cents: number }[]> {
  const rows = await db.query<Raw>(
    `select contribution_id, sum(amount_cents)::bigint as n from public.pool_allocations where bounty_id = $1
      group by contribution_id having sum(amount_cents) > 0 order by contribution_id nulls first`,
    [bountyId],
  );
  return rows.map((r) => ({ contribution_id: (r.contribution_id as string | null) ?? null, cents: num(r.n) }));
}

export interface FundingSourceRow {
  contribution_id: string | null;
  sponsor_name: string | null;
  sponsor_url: string | null;
  contribution: ContributionRow | null;
  cents: number;
}

/** Where a request's allocation came from (general pool rows have no sponsor). */
export async function fundingSources(db: Db, bountyId: string): Promise<FundingSourceRow[]> {
  const held = await heldByBucket(db, bountyId);
  const out: FundingSourceRow[] = [];
  for (const h of held) {
    const c = h.contribution_id ? await getContribution(db, h.contribution_id) : null;
    out.push({ contribution_id: h.contribution_id, sponsor_name: c?.sponsor_name ?? null, sponsor_url: c?.sponsor_url ?? null, contribution: c, cents: h.cents });
  }
  // same order the engine draws in: earmarks first, the general pool last
  return out.sort((a, b) => Number(a.contribution_id === null) - Number(b.contribution_id === null));
}

/**
 * Locked quotes on this request that may still be paid: open unexpired sessions, and sessions whose
 * submission is still pending, verifying or waiting for a human. Sum of quotes (not worst case).
 */
export async function committedQuoteCents(db: Db, bountyId: string, now: Date): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select coalesce(sum(cs.price_quote_cents), 0)::int as n from public.capture_sessions cs
      where cs.bounty_id = $1
        and ((cs.status = 'open' and cs.expires_at > $2::timestamptz)
             or exists (select 1 from public.submissions s
                         where s.session_id = cs.id and s.status in ('pending', 'verifying', 'needs_review')))`,
    [bountyId, now.toISOString()],
  );
  return num(rows[0]?.n);
}

/** Sets the request's funding state; status only when given. */
export async function setFundingState(
  db: Db,
  bountyId: string,
  s: { status?: "active" | "pending_funding" | "closed" | "paused"; funding_reason: string | null; markFunded?: boolean; sponsor?: { name: string | null; url: string | null } },
): Promise<void> {
  const params: (string | null)[] = [bountyId, s.funding_reason];
  const sets = ["funding_reason = $2"];
  if (s.status) {
    params.push(s.status);
    sets.push(`status = $${params.length}::public.bounty_status`);
  }
  if (s.markFunded) sets.push("funded_at = coalesce(funded_at, now())");
  if (s.sponsor) {
    params.push(s.sponsor.name);
    sets.push(`sponsor_name = $${params.length}`);
    params.push(s.sponsor.url);
    sets.push(`sponsor_url = $${params.length}`);
  }
  await db.query(`update public.bounties set ${sets.join(", ")} where id = $1`, params);
}

export interface RequestRow {
  id: string;
  title: string;
  status: string;
  protocol_id: string;
  protocol_slug: string;
  protocol_name: string;
  created_by: string | null;
  requested_by: string | null;
  created_at: string;
  starts_at: string;
  ends_at: string;
  cells_total: number;
  target_per_cell: number;
  justification: string | null;
  funding_reason: string | null;
  budget_cents: number;
  spent_cents: number;
}

export async function listRequests(db: Db, statuses: string[]): Promise<RequestRow[]> {
  const rows = await db.query<Raw>(
    `select b.id, b.title, b.status::text as status, b.protocol_id, p.slug as protocol_slug, p.name as protocol_name, b.created_by,
            u.email as requested_by, b.created_at, b.starts_at, b.ends_at, cardinality(b.cells) as cells_total, b.target_per_cell,
            b.justification, b.funding_reason, b.budget_cents, b.spent_cents
       from public.bounties b
       join public.protocols p on p.id = b.protocol_id
       left join auth.users u on u.id = b.created_by
      where b.status::text = any($1::text[])
      order by b.created_at`,
    [statuses],
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    status: String(r.status),
    protocol_id: String(r.protocol_id),
    protocol_slug: String(r.protocol_slug),
    protocol_name: String(r.protocol_name),
    created_by: (r.created_by as string | null) ?? null,
    requested_by: (r.requested_by as string | null) ?? null,
    created_at: toIso(r.created_at),
    starts_at: toIso(r.starts_at),
    ends_at: toIso(r.ends_at),
    cells_total: num(r.cells_total),
    target_per_cell: num(r.target_per_cell),
    justification: (r.justification as string | null) ?? null,
    funding_reason: (r.funding_reason as string | null) ?? null,
    budget_cents: num(r.budget_cents),
    spent_cents: num(r.spent_cents),
  }));
}

/** Requests of this researcher that currently hold pool money and are live (auto-funding guardrail). */
export async function countFundedLive(db: Db, userId: string, now: Date): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from public.bounties
      where created_by = $1 and status in ('active', 'paused') and budget_cents > spent_cents and ends_at > $2::timestamptz`,
    [userId, now.toISOString()],
  );
  return num(rows[0]?.n);
}

/** Active, funded, live requests for one protocol (demand factor). */
export async function liveFundedForProtocol(db: Db, protocolId: string, now: Date): Promise<{ id: string; created_by: string | null; cells: string[] }[]> {
  return db.query<{ id: string; created_by: string | null; cells: string[] }>(
    `select id, created_by, cells from public.bounties
      where protocol_id = $1 and status = 'active' and budget_cents > spent_cents
        and starts_at <= $2::timestamptz and ends_at > $2::timestamptz`,
    [protocolId, now.toISOString()],
  );
}

/** Distinct contributors who opened a capture session per cell since `since` (supply factor). */
export async function recentContributorsByCell(db: Db, cells: string[], since: Date): Promise<Map<string, Set<string>>> {
  if (cells.length === 0) return new Map();
  const rows = await db.query<{ cell: string; user_id: string }>(
    `select distinct cell, user_id from public.capture_sessions where cell = any($1::text[]) and started_at >= $2::timestamptz`,
    [cells, since.toISOString()],
  );
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = out.get(r.cell) ?? new Set<string>();
    s.add(r.user_id);
    out.set(r.cell, s);
  }
  return out;
}

/** Live requests that ended (plus a grace period) and still hold unspent allocation. */
export async function endedWithAllocation(db: Db, before: Date): Promise<{ id: string }[]> {
  return db.query<{ id: string }>(
    `select id from public.bounties where status in ('active', 'paused') and ends_at <= $1::timestamptz and budget_cents > spent_cents
      order by ends_at`,
    [before.toISOString()],
  );
}

export async function countRequestsByStatus(db: Db): Promise<{ active: number; pending: number }> {
  const rows = await db.query<{ active: number; pending: number }>(
    `select count(*) filter (where status = 'active')::int as active, count(*) filter (where status::text = 'pending_funding')::int as pending
       from public.bounties`,
  );
  return { active: num(rows[0]?.active), pending: num(rows[0]?.pending) };
}

