/** Builders for the admin Funding page and the public transparency endpoint. */
import type { Contribution, FundingOverview, FundingRequest, PoolBucket, PublicFundingResponse } from "@groundtruth/shared";
import type { Db } from "../db";
import {
  countRequestsByStatus,
  listContributions,
  listRequests,
  listSponsors,
  poolBuckets,
  poolTotals,
  type ContributionRow,
  type RequestRow,
} from "../db/repos/funding";
import { getProtocol } from "../db/repos/protocols";
import type { Protocol } from "@groundtruth/shared";
import { estimateNeedCents, minViableCents } from "./allocation";
import { earmarkLabel } from "./labels";

export function contributionView(c: ContributionRow, byId: Map<string, ContributionRow>): Contribution {
  const orig = c.reverses_id ? (byId.get(c.reverses_id) ?? null) : c;
  return {
    id: c.id,
    sponsor_id: c.sponsor_id,
    sponsor_name: c.sponsor_name,
    kind: c.kind,
    amount_cents: c.amount_cents,
    reverses_id: c.reverses_id,
    earmark: c.kind === "reversal" ? `Reversal · ${orig ? earmarkLabel(orig) : "earlier entry"}` : earmarkLabel(c),
    protocol_slug: c.protocol_slug,
    bounty_id: c.bounty_id,
    note: c.note,
    created_at: c.created_at,
  };
}

async function requestViews(db: Db, rows: RequestRow[]): Promise<FundingRequest[]> {
  const protocols = new Map<string, Protocol | null>();
  const out: FundingRequest[] = [];
  for (const r of rows) {
    if (!protocols.has(r.protocol_id)) protocols.set(r.protocol_id, (await getProtocol(db, r.protocol_id))?.definition ?? null);
    const p = protocols.get(r.protocol_id);
    const need = p ? { cells: r.cells_total, targetPerCell: r.target_per_cell, protocol: p } : null;
    out.push({
      id: r.id,
      title: r.title,
      status: r.status,
      protocol_slug: r.protocol_slug,
      protocol_name: r.protocol_name,
      requested_by: r.requested_by,
      created_at: r.created_at,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      cells_total: r.cells_total,
      target_per_cell: r.target_per_cell,
      justification: r.justification,
      funding_reason: r.funding_reason,
      allocation_cents: r.budget_cents,
      spent_cents: r.spent_cents,
      estimated_need_cents: need ? estimateNeedCents(need) : 0,
      min_viable_cents: need ? minViableCents(need) : 0,
    });
  }
  return out;
}

export async function fundingOverview(db: Db): Promise<FundingOverview> {
  const [totals, buckets, sponsors, contributions, pending, funded] = await Promise.all([
    poolTotals(db),
    poolBuckets(db),
    listSponsors(db),
    listContributions(db, 200),
    listRequests(db, ["pending_funding"]),
    listRequests(db, ["active", "paused"]),
  ]);
  const byId = new Map(contributions.map((c) => [c.id, c]));
  const bucketViews: PoolBucket[] = [];
  for (const b of buckets) {
    const c = b.contribution_id ? (byId.get(b.contribution_id) ?? null) : null;
    bucketViews.push({
      contribution_id: b.contribution_id,
      sponsor_name: c?.sponsor_name ?? null,
      earmark: b.contribution_id ? (c ? earmarkLabel(c) : "Earmark") : "General pool",
      contributed_cents: b.contributed_cents,
      allocated_cents: b.allocated_cents,
      paid_cents: b.paid_cents,
      available_cents: b.available_cents,
    });
  }
  return {
    totals,
    buckets: bucketViews,
    sponsors: sponsors.map((s) => ({ ...s })),
    pending: await requestViews(db, pending),
    funded: await requestViews(db, funded.filter((r) => r.budget_cents > 0)),
    contributions: contributions.map((c) => contributionView(c, byId)),
  };
}

/** Public: active sponsors and pool totals. No per-user or per-request data. */
export async function publicFunding(db: Db, now = new Date()): Promise<PublicFundingResponse> {
  const [totals, sponsors, requests] = await Promise.all([poolTotals(db), listSponsors(db), countRequestsByStatus(db)]);
  return {
    sponsors: sponsors
      .filter((s) => s.active && s.contributed_cents > 0)
      .sort((a, b) => b.contributed_cents - a.contributed_cents)
      .map((s) => ({ id: s.id, name: s.name, url: s.url, logo_url: s.logo_url, contributed_cents: s.contributed_cents })),
    totals,
    requests,
    updated_at: now.toISOString(),
  };
}
