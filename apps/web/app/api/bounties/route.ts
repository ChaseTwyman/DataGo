import {
  cellsForCircle,
  cellsForPolygon,
  circlePolygon,
  CreateBountyRequestSchema,
  type BountyListItem,
  type CreateBountyResponseSchema,
} from "@groundtruth/shared";
import type { z } from "zod";
import { badRequest, json, notFound, parseBody, route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { insertBounty, listBountiesFor } from "@/lib/db/repos/bounties";
import { getProtocol } from "@/lib/db/repos/protocols";
import { fundRequest } from "@/lib/funding/allocation";
import { protocolRate } from "@/lib/pricing/engine";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

/** Researcher: own bounties; admin: all. */
export const GET = route(async (req) => {
  const user = await requireResearcher(req);
  const rows = await listBountiesFor(await getDb(), user.id, user.isAdmin);
  const bounties: BountyListItem[] = rows.map((b) => ({
    id: b.id,
    title: b.title,
    status: b.status,
    protocol_slug: b.protocol_slug,
    protocol_name: b.protocol_name,
    center_lat: b.center_lat,
    center_lng: b.center_lng,
    cells_total: b.cells.length,
    accepted: b.accepted,
    pending_review: b.pending_review,
    budget_cents: b.budget_cents,
    spent_cents: b.spent_cents,
    ends_at: b.ends_at,
    created_at: b.created_at,
  }));
  return json({ bounties });
});

/**
 * Submit a data request: area = polygon if given, else a circle; cells = H3 res 9 cover. Starts as
 * pending_funding; the allocation engine funds it from the sponsor pool right away when it can.
 * Prices are the platform's (lib/pricing): the stored base/max are the protocol's floor/ceiling.
 */
export const POST = route(async (req) => {
  const user = await requireResearcher(req);
  const body = await parseBody(req, CreateBountyRequestSchema);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.dataRequest, user.id);
  const protocol = await getProtocol(db, body.protocol_id);
  if (!protocol) throw notFound("Protocol not found");
  if (protocol.status !== "published") throw badRequest("Protocol is not published");
  const area = body.area ?? circlePolygon(body.center_lat, body.center_lng, body.radius_m);
  let cells = body.area ? cellsForPolygon(body.area) : cellsForCircle(body.center_lat, body.center_lng, body.radius_m);
  if (cells.length === 0) cells = cellsForCircle(body.center_lat, body.center_lng, 50);
  if (cells.length > 2000) throw badRequest("Area too large (more than 2000 cells)");
  const rate = protocolRate(protocol.definition);
  // Only admins may label a request as a demo; everyone else's is manual/radar.
  const source = !user.isAdmin && (body.source === "demo" || body.source === "nws") ? "manual" : body.source;
  const id = await insertBounty(db, {
    protocol_id: body.protocol_id,
    created_by: user.id,
    title: body.title,
    summary: body.summary,
    area,
    center_lat: body.center_lat,
    center_lng: body.center_lng,
    radius_m: body.radius_m,
    cells,
    starts_at: body.starts_at,
    ends_at: body.ends_at,
    event_started_at: body.event_started_at,
    base_price_cents: rate.baseCents,
    max_price_cents: rate.ceilingCents,
    target_per_cell: body.target_per_cell,
    priority: 1,
    budget_cents: 0,
    status: "pending_funding",
    source,
    justification: body.justification || null,
  });
  const funded = await fundRequest(db, id, { creatorIsAdmin: user.isAdmin });
  const res: z.infer<typeof CreateBountyResponseSchema> = {
    id,
    cells,
    status: funded.status,
    allocation_cents: funded.allocationCents,
    funding_reason: funded.fundingReason,
  };
  return json(res, { status: 201 });
});
