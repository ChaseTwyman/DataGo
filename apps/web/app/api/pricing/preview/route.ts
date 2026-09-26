import {
  cellsForCircle,
  cellsForPolygon,
  PricingPreviewRequestSchema,
  type PricingPreviewResponse,
} from "@groundtruth/shared";
import { badRequest, json, notFound, parseBody, route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getProtocol } from "@/lib/db/repos/protocols";
import { decideAuto } from "@/lib/funding/allocation";
import { publicCell } from "@/lib/pricing/engine";
import { loadPricing } from "@/lib/pricing/market";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

/**
 * Researcher: what the platform's pricing engine would pay per cell for a draft request right now,
 * and whether the allocation engine would fund it. Prices are computed only on the server; the
 * engine's factor weights never leave it (cells carry price, surge and human-readable reasons).
 */
export const POST = route(async (req) => {
  const user = await requireResearcher(req);
  const body = await parseBody(req, PricingPreviewRequestSchema);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.pricingPreview, user.id);
  const protocol = await getProtocol(db, body.protocol_id);
  if (!protocol || (protocol.status !== "published" && protocol.created_by !== user.id && !user.isAdmin)) throw notFound("Protocol not found");
  if (Date.parse(body.ends_at) <= Date.parse(body.starts_at)) throw badRequest("ends_at <= starts_at");
  let cells = body.area ? cellsForPolygon(body.area) : cellsForCircle(body.center_lat, body.center_lng, body.radius_m);
  if (cells.length === 0) cells = cellsForCircle(body.center_lat, body.center_lng, 50);
  if (cells.length > 2000) throw badRequest("Area too large (more than 2000 cells)");

  const decision = await decideAuto(db, {
    bountyId: null,
    createdBy: user.id,
    creatorIsAdmin: user.isAdmin,
    protocol: protocol.definition,
    lat: body.center_lat,
    lng: body.center_lng,
    cells: cells.length,
    targetPerCell: body.target_per_cell,
    endsAt: body.ends_at,
  });
  const pricing = await loadPricing(
    db,
    {
      id: null,
      created_by: user.id,
      protocol_id: protocol.id,
      cells,
      center_lat: body.center_lat,
      center_lng: body.center_lng,
      target_per_cell: body.target_per_cell,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      event_started_at: body.event_started_at,
      // price as if funded with what the engine would allocate (or the full need, for display)
      budget_cents: decision.allocationCents || decision.needCents,
      spent_cents: 0,
    },
    protocol.definition,
  );
  const open = pricing.cells.filter((c) => !c.paused);
  const prices = (open.length ? open : pricing.cells).map((c) => c.price_cents).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)] ?? pricing.rate.baseCents;
  const medianCell = (open.length ? open : pricing.cells).find((c) => c.price_cents === median);
  const res: PricingPreviewResponse = {
    cells: pricing.cells.map(publicCell),
    cells_total: cells.length,
    base_cents: pricing.rate.baseCents,
    ceiling_cents: pricing.rate.ceilingCents,
    price_cents: median,
    min_price_cents: prices[0] ?? median,
    max_price_cents: prices[prices.length - 1] ?? median,
    surge: medianCell?.surge ?? 1,
    max_surge: Math.max(1, ...pricing.cells.map((c) => c.surge)),
    price_reasons: medianCell?.price_reasons ?? [],
    estimated_need_cents: decision.needCents,
    min_viable_cents: decision.minViableCents,
    funding: { would_fund: decision.reason === null, allocation_cents: decision.allocationCents, reason: decision.reason },
  };
  return json(res);
});
