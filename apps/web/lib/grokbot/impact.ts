/**
 * Phase 5: sponsor impact report. Aggregates only: money in, money paid out for verified readings,
 * accepted observations, distinct H3 cells (a count; no cell ids, no coordinates), requests funded,
 * top protocols. Never user ids, emails, photos, or locations. Mock/unverified rows never count
 * (same rule as the open dataset).
 *
 * Admin (GET /api/grokbot/sponsors/:id/impact) may trigger one cached model narrative; the public
 * endpoint NEVER calls the model (anyone could hammer it): it reuses the admin narrative when one
 * exists for the same facts, else the template.
 */
import { SponsorImpactSchema, type SponsorImpact } from "@groundtruth/shared";
import type { Db } from "../db";
import { getSponsor, type SponsorRow } from "../db/repos/funding";
import { cacheGet, caseVersion } from "./cache";
import { dollars } from "./caseFile";
import { composeMessage, finalize, type Generate } from "./compose";
import type { Period } from "./period";
import { impactTemplate } from "./templates";
import type { CaseFile, Fact } from "./types";

const num = (v: unknown) => Number(v ?? 0);
const day = (iso: string) => iso.slice(0, 10);

export interface ImpactFigures {
  contributed_cents: number;
  spent_cents: number;
  observations_accepted: number;
  cells_covered: number;
  requests_funded: number;
  protocols: { name: string; n: number }[];
}

/** Earmarks are credited fully; general-pool money in proportion to the sponsor's share of the general pool. */
export async function impactFigures(db: Db, sponsorId: string, from: string, to: string): Promise<ImpactFigures> {
  const [money] = await db.query<Record<string, unknown>>(
    `with c as (
       select o.id,
              (o.protocol_slug is not null or o.bounty_id is not null or o.region_center_lat is not null or o.region_polygon is not null) as earmarked,
              o.sponsor_id,
              o.amount_cents - coalesce((select sum(r.amount_cents) from public.sponsor_contributions r
                                          where r.reverses_id = o.id and r.created_at <= $3::timestamptz), 0) as net,
              o.created_at
         from public.sponsor_contributions o
        where o.kind = 'contribution' and o.created_at <= $3::timestamptz
     ),
     gen as (select coalesce(sum(net), 0)::float8 as total, coalesce(sum(net) filter (where sponsor_id = $1), 0)::float8 as mine from c where not earmarked)
     select
       (select coalesce(sum(net), 0) from c where sponsor_id = $1 and created_at >= $2::timestamptz)::bigint as contributed,
       (select coalesce(sum(pb.paid_cents), 0) from public.pool_buckets pb join c on c.id = pb.contribution_id where c.sponsor_id = $1)::bigint as earmark_paid,
       (select coalesce(sum(pb.paid_cents), 0) from public.pool_buckets pb where pb.contribution_id is null)::bigint as general_paid,
       (select case when total > 0 then mine / total else 0 end from gen) as share`,
    [sponsorId, from, to],
  );
  const share = num(money?.share);
  const spent = Math.round(num(money?.earmark_paid) + num(money?.general_paid) * share);
  const funded = await db.query<{ id: string }>(
    `with mine as (
       select id from public.sponsor_contributions
        where sponsor_id = $1 and kind = 'contribution' and created_at <= $3::timestamptz
          and (protocol_slug is not null or bounty_id is not null or region_center_lat is not null or region_polygon is not null)
     )
     select a.bounty_id as id from public.pool_allocations a join public.bounties b on b.id = a.bounty_id
      where a.created_at <= $3::timestamptz and b.starts_at < $3::timestamptz and b.ends_at > $2::timestamptz
        and (a.contribution_id in (select id from mine) or (a.contribution_id is null and $4::boolean))
      group by a.bounty_id having sum(a.amount_cents) > 0`,
    [sponsorId, from, to, share > 0],
  );
  const ids = funded.map((r) => r.id);
  if (ids.length === 0) {
    return { contributed_cents: num(money?.contributed), spent_cents: spent, observations_accepted: 0, cells_covered: 0, requests_funded: 0, protocols: [] };
  }
  const [obs] = await db.query<{ n: number; cells: number }>(
    `select count(*)::int as n, count(distinct h3_cell)::int as cells from public.submissions
      where bounty_id = any($1::uuid[]) and status = 'accepted' and verifier in ('model', 'human')
        and received_at >= $2::timestamptz and received_at <= $3::timestamptz`,
    [ids, from, to],
  );
  const protocols = await db.query<{ name: string; n: number }>(
    `select p.name, count(*)::int as n from public.submissions s join public.bounties b on b.id = s.bounty_id join public.protocols p on p.id = b.protocol_id
      where s.bounty_id = any($1::uuid[]) and s.status = 'accepted' and s.verifier in ('model', 'human')
        and s.received_at >= $2::timestamptz and s.received_at <= $3::timestamptz
      group by p.name order by n desc, p.name limit 3`,
    [ids, from, to],
  );
  return {
    contributed_cents: num(money?.contributed),
    spent_cents: spent,
    observations_accepted: obs?.n ?? 0,
    cells_covered: obs?.cells ?? 0,
    requests_funded: ids.length,
    protocols,
  };
}

export function impactCase(s: SponsorRow, f: ImpactFigures, from: string, to: string, audience: "admin" | "public"): CaseFile {
  const cite = (ref: string) => ({ kind: "pool" as const, ref, detail: null });
  const facts: Fact[] = [
    { id: "impact.sponsor", citation: cite("sponsor"), text: `${s.name}: impact from ${day(from)} to ${day(to)}.` },
    { id: "impact.contributed", citation: cite("contributed"), text: `Contributed ${dollars(f.contributed_cents)} to the sponsor pool in this period.` },
    { id: "impact.spent", citation: cite("spent"), text: `About ${dollars(f.spent_cents)} of this sponsor's money has been paid to contributors for verified readings.` },
    { id: "impact.requests", citation: cite("requests_funded"), text: `${f.requests_funded} data requests were funded at least in part by this sponsor.` },
    { id: "impact.observations", citation: { kind: "observation", ref: "accepted", detail: null }, text: `${f.observations_accepted} verified observations were accepted on those requests.` },
    { id: "impact.cells", citation: { kind: "observation", ref: "cells", detail: null }, text: `They cover ${f.cells_covered} distinct map cells.` },
  ];
  f.protocols.forEach((p, i) =>
    facts.push({ id: `impact.protocol.${i}`, citation: { kind: "protocol", ref: p.name.slice(0, 120), detail: null }, text: `${p.name}: ${p.n} observations.` }),
  );
  return { kind: "impact", subjectId: `${s.id}:${day(from)}:${day(to)}`, audience, facts, untrusted: [], injectionFlags: [] };
}

function highlights(f: ImpactFigures): string[] {
  const out = [
    `${f.requests_funded} data requests funded`,
    `${f.observations_accepted} verified observations`,
    `${f.cells_covered} map cells covered`,
    `${dollars(f.spent_cents)} paid to contributors`,
  ];
  for (const p of f.protocols) out.push(`${p.name}: ${p.n} observations`);
  return out.slice(0, 6).map((s) => s.slice(0, 240));
}

export async function sponsorImpact(
  db: Db,
  sponsorId: string,
  period: Period,
  o: { audience: "admin" | "public"; mockError?: boolean; generate?: Generate; refresh?: boolean },
): Promise<SponsorImpact | null> {
  const s = await getSponsor(db, sponsorId);
  if (!s) return null;
  if (o.audience === "public" && (!s.active || s.contributed_cents <= 0)) return null;
  // All time: count everything (observations on a request can predate the sponsor's record, e.g.
  // pre-pool budgets migrated in 000007); the report says it starts at the sponsor's creation.
  const from = period.from ?? s.created_at;
  const f = await impactFigures(db, s.id, period.from ?? "1970-01-01T00:00:00.000Z", period.to);
  const c = impactCase(s, f, from, period.to, o.audience);
  let narrative;
  if (o.audience === "admin") {
    narrative = await composeMessage(db, {
      op: "impact",
      caseFile: c,
      task: "Write a short impact summary for this sponsor, suitable to share publicly. Aggregates only; never mention individuals or exact places.",
      template: impactTemplate(c),
      ttlSeconds: 6 * 3600,
      ...(o.mockError ? { mockError: true } : {}),
      ...(o.generate ? { generate: o.generate } : {}),
      ...(o.refresh ? { refresh: true } : {}),
    });
  } else {
    // Same facts → same version: reuse what an admin already generated; never call the model here.
    const reused = await cacheGet<SponsorImpact["narrative"]>(db, { kind: "impact", subjectId: c.subjectId, audience: "admin", version: caseVersion(c) });
    narrative = reused ?? finalize(impactTemplate(c), c, "template");
  }
  return SponsorImpactSchema.parse({
    sponsor_id: s.id,
    sponsor_name: s.name,
    period_from: new Date(from).toISOString(),
    period_to: new Date(period.to).toISOString(),
    contributed_cents: f.contributed_cents,
    spent_cents: f.spent_cents,
    observations_accepted: f.observations_accepted,
    cells_covered: f.cells_covered,
    requests_funded: f.requests_funded,
    highlights: highlights(f),
    narrative,
  });
}
