import { RadarScanRequestSchema, type RadarScanResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { activeAlertsAt, type NwsAlert } from "@/lib/context/nws";
import { getDb } from "@/lib/db";
import { upsertAlerts } from "@/lib/db/repos/alerts";
import { listProtocols } from "@/lib/db/repos/protocols";
import { isOffline } from "@/lib/env";
import { GrokError } from "@/lib/grok/config";
import { radarDrafts } from "@/lib/radar";

export const maxDuration = 240;

/** Opportunity Radar: NWS alerts + Grok (x_search, web_search) → drafted bounties for approval. */
export const POST = route(async (req) => {
  const user = await requireResearcher(req);
  const body = await parseBody(req, RadarScanRequestSchema);
  const db = await getDb();
  let alerts: NwsAlert[] = [];
  if (!isOffline()) {
    try {
      alerts = await activeAlertsAt(body.lat, body.lng);
      if (alerts.length) await upsertAlerts(db, alerts);
    } catch (err) {
      console.warn("[radar] NWS unavailable:", err instanceof Error ? err.message : err);
    }
  }
  const protocols = (await listProtocols(db, user.id, user.role === "admin"))
    .filter((p) => p.status === "published")
    .map((p) => ({ slug: p.slug, name: p.name, why_it_matters: p.definition.why_it_matters }));
  try {
    const drafts = await radarDrafts({ lat: body.lat, lng: body.lng, radiusKm: body.radius_km, alerts, protocols });
    const res: z.infer<typeof RadarScanResponseSchema> = { drafts, alerts_considered: alerts.length };
    return json(res);
  } catch (err) {
    if (err instanceof GrokError) throw new HttpError(502, "GROK_UNAVAILABLE", err.message);
    throw err;
  }
});
