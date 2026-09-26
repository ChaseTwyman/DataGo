/**
 * Market snapshot for the pricing engine: everything engine.ts needs about one request, loaded from
 * the database (accepted counts, hazard pauses, other requests and sponsor earmarks wanting the same
 * cells, recent contributor activity, allocation and locked quotes).
 */
import { gridDisk } from "h3-js";
import { cellCenter, haversineM, hoursBetween, pointInPolygon, urgencyTauHours, type CellPrice, type Protocol } from "@groundtruth/shared";
import type { Db } from "../db";
import { acceptedByCell, type BountyRow } from "../db/repos/bounties";
import { committedQuoteCents, liveFundedForProtocol, openEarmarks, recentContributorsByCell, type ContributionRow } from "../db/repos/funding";
import { pausedCells } from "../hazards";
import { activeMissionsByCell } from "../missions/repo";
import { PRICING } from "./config";
import { priceCells, protocolRate, publicCell, worstCaseCents, type CellMarket, type PriceCellsResult, type ProtocolRate } from "./engine";

/** Does an earmark's protocol/region filter match a point? (bounty-specific earmarks are handled by the caller.) */
export function earmarkCovers(
  c: Pick<ContributionRow, "protocol_slug" | "region_center_lat" | "region_center_lng" | "region_radius_m" | "region_polygon">,
  protocolSlug: string,
  lat: number,
  lng: number,
): boolean {
  if (c.protocol_slug !== null && c.protocol_slug !== protocolSlug) return false;
  if (c.region_center_lat !== null && c.region_center_lng !== null && c.region_radius_m !== null) {
    if (haversineM(lat, lng, c.region_center_lat, c.region_center_lng) > c.region_radius_m) return false;
  }
  if (c.region_polygon && !pointInPolygon(lat, lng, c.region_polygon)) return false;
  return true;
}

export interface MarketRequest {
  id: string | null;
  created_by: string | null;
  protocol_id: string;
  cells: string[];
  center_lat: number;
  center_lng: number;
  target_per_cell: number;
  starts_at: string;
  ends_at: string;
  event_started_at: string | null;
  budget_cents: number;
  spent_cents: number;
}

export interface Pricing extends PriceCellsResult {
  rate: ProtocolRate;
  committedCents: number;
}

export interface PricingViewer {
  /**
   * Who the price is for. Revisit missions boost the price only for someone who may fill them (the
   * original contributor during first dibs, anyone after). Omitted: an operator view (boost shown).
   */
  viewerId?: string | null;
}

/** Prices every cell of a request (existing, or a draft when `id` is null). */
export async function loadPricing(db: Db, req: MarketRequest, protocol: Protocol, now = new Date(), viewer: PricingViewer = {}): Promise<Pricing> {
  const since = new Date(now.getTime() - PRICING.supply.windowHours * 3_600_000);
  const disk = new Map(req.cells.map((c) => [c, safeDisk(c)]));
  const allNear = [...new Set([...disk.values()].flat())];
  const [accepted, paused, others, earmarks, recent, committedQuotes, missions] = await Promise.all([
    req.id ? acceptedByCell(db, req.id) : Promise.resolve(new Map<string, number>()),
    pausedCells(db, req, now),
    liveFundedForProtocol(db, req.protocol_id, now),
    openEarmarks(db),
    recentContributorsByCell(db, allNear, since),
    req.id ? committedQuoteCents(db, req.id, now) : Promise.resolve(0),
    req.id ? activeMissionsByCell(db, req.id, now) : Promise.resolve(new Map<string, { original_user_id: string | null; dibs_until: string }[]>()),
  ]);

  // Demand: other researchers' funded requests (a researcher's own overlapping requests never count)
  // Counted per distinct other researcher (not per request), and only requests with a meaningful
  // allocation left, so cheap shell requests from one account can't stack demand.
  const otherOwners = new Map<string, Set<string>>();
  for (const o of others) {
    if (o.id === req.id || (req.created_by !== null && o.created_by === req.created_by)) continue;
    if (o.remaining_cents < PRICING.demand.minRemainingCents) continue;
    const owner = o.created_by ?? o.id;
    for (const c of o.cells) otherOwners.set(c, (otherOwners.get(c) ?? new Set<string>()).add(owner));
  }
  const otherCells = new Map([...otherOwners].map(([c, owners]) => [c, owners.size]));
  const earmarksHere = earmarks.filter((e) => e.bounty_id === null);

  const cells: CellMarket[] = req.cells.map((cell) => {
    const ctr = cellCenter(cell);
    const wants = (otherCells.get(cell) ?? 0) + earmarksHere.filter((e) => earmarkCovers(e, protocol.slug, ctr.lat, ctr.lng)).length;
    const users = new Set<string>();
    for (const n of disk.get(cell) ?? [cell]) for (const u of recent.get(n) ?? []) users.add(u);
    return {
      cell,
      accepted: accepted.get(cell) ?? 0,
      target: req.target_per_cell,
      pausedReason: paused.get(cell) ?? null,
      otherWants: wants,
      activeContributors: users.size,
      ...revisitFor(missions.get(cell), viewer, now),
    };
  });

  const rate = protocolRate(protocol);
  const committedCents = committedQuotes > 0 ? worstCaseCents(committedQuotes) : 0;
  const res = priceCells({
    rate,
    tauHours: urgencyTauHours(protocol),
    hoursSinceEvent: req.event_started_at ? hoursBetween(req.event_started_at, now) : null,
    cells,
    pacing: {
      allocationCents: req.budget_cents,
      spentCents: req.spent_cents,
      committedCents,
      startsAt: req.starts_at,
      endsAt: req.ends_at,
      now,
    },
  });
  return { ...res, rate, committedCents };
}

function revisitFor(
  ms: { original_user_id: string | null; dibs_until: string }[] | undefined,
  viewer: PricingViewer,
  now: Date,
): Pick<CellMarket, "revisit"> {
  if (!ms || ms.length === 0) return {};
  const boost =
    viewer.viewerId === undefined || ms.some((m) => (viewer.viewerId && m.original_user_id === viewer.viewerId) || now.getTime() >= Date.parse(m.dibs_until));
  return { revisit: { due: ms.length, boost } };
}

function safeDisk(cell: string): string[] {
  try {
    return gridDisk(cell, PRICING.supply.ringK);
  } catch {
    return [cell];
  }
}

export const bountyMarket = (b: BountyRow): MarketRequest => b;

/** Public per-cell prices (no internal factors). */
export async function loadCoverage(db: Db, bounty: BountyRow, protocol: Protocol, now = new Date()): Promise<CellPrice[]> {
  return (await loadPricing(db, bounty, protocol, now)).cells.map(publicCell);
}
