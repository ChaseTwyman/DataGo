import { RadarScanRequestSchema, type RadarScanResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { grokUnavailable, json, parseBody, route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { activeAlertsAt, type NwsAlert } from "@/lib/context/nws";
import { getDb } from "@/lib/db";
import { upsertAlerts } from "@/lib/db/repos/alerts";
import { listProtocols } from "@/lib/db/repos/protocols";
import { isOffline } from "@/lib/env";
import { GrokError } from "@/lib/grok/config";
import { estimateDraftFunding, poolSummaryForRadar } from "@/lib/grokbot/bounty";
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
  const published = (await listProtocols(db, user.id, user.isAdmin)).filter((p) => p.status === "published");
  const protocols = published.map((p) => ({ slug: p.slug, name: p.name, why_it_matters: p.definition.why_it_matters }));
  // Grokbot: the model sees what the pool can fund; each draft then gets the allocator's own estimate.
  const poolSummary = await poolSummaryForRadar(db).catch(() => undefined);
  try {
    const drafted = await radarDrafts({ lat: body.lat, lng: body.lng, radiusKm: body.radius_km, alerts, protocols, ...(poolSummary ? { poolSummary } : {}) });
    const drafts = await Promise.all(
      drafted.map(async (d) => {
        const p = published.find((x) => x.slug === d.protocol_slug);
        if (!p) return d;
        try {
          return { ...d, funding: await estimateDraftFunding(db, { protocol: p.definition, center_lat: d.center_lat, center_lng: d.center_lng, radius_m: d.radius_m }, user) };
        } catch (err) {
          console.warn("[radar] funding estimate failed:", err instanceof Error ? err.message : err);
          return d;
        }
      }),
    );
    const res: z.infer<typeof RadarScanResponseSchema> = { drafts, alerts_considered: alerts.length };
    return json(res);
  } catch (err) {
    if (err instanceof GrokError) throw grokUnavailable(err, "radar scan");
    throw err;
  }
});
