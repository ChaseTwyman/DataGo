import {
  cellsForCircle,
  cellsForPolygon,
  circlePolygon,
  CreateBountyRequestSchema,
  type BountyListItem,
} from "@groundtruth/shared";
import { badRequest, json, notFound, parseBody, route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { insertBounty, listBountiesFor } from "@/lib/db/repos/bounties";
import { getProtocol } from "@/lib/db/repos/protocols";

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

/** Create a bounty: area = polygon if given, else a circle; cells = H3 res 9 cover. */
export const POST = route(async (req) => {
  const user = await requireResearcher(req);
  const body = await parseBody(req, CreateBountyRequestSchema);
  const db = await getDb();
  const protocol = await getProtocol(db, body.protocol_id);
  if (!protocol) throw notFound("Protocol not found");
  if (protocol.status !== "published") throw badRequest("Protocol is not published");
  const area = body.area ?? circlePolygon(body.center_lat, body.center_lng, body.radius_m);
  let cells = body.area ? cellsForPolygon(body.area) : cellsForCircle(body.center_lat, body.center_lng, body.radius_m);
  if (cells.length === 0) cells = cellsForCircle(body.center_lat, body.center_lng, 50);
  if (cells.length > 2000) throw badRequest("Area too large (more than 2000 cells)");
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
    base_price_cents: body.base_price_cents,
    max_price_cents: body.max_price_cents,
    target_per_cell: body.target_per_cell,
    priority: body.priority,
    budget_cents: body.budget_cents,
    status: body.status,
    source: body.source,
    sponsor_name: body.sponsor_name?.trim() || null,
    sponsor_url: body.sponsor_url,
  });
  return json({ id, cells }, { status: 201 });
});
