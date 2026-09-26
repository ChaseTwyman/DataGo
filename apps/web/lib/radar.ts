/**
 * Opportunity Radar (P1): pull NWS alerts for a region, then grok-4.7 with x_search + web_search and a
 * strict schema drafts bounties for the researcher to approve (approval = POST /api/bounties).
 * Structured outputs with server-side tools is supported on Grok 4 models (docs.x.ai, structured-outputs).
 */
import { DraftBountySchema, type DraftBounty } from "@groundtruth/shared";
import { z } from "zod";
import { closeObjects, type JsonSchema } from "@groundtruth/shared";
import type { NwsAlert } from "./context/nws";
import { grokEnv } from "./grok/config";
import { grokJSON } from "./grok/json";
import { mockRadarDrafts } from "./grok/mocks/p1";

/** What the model returns: drafts WITHOUT funding (that is the allocator's answer, computed after). */
export const RadarModelDraftSchema = DraftBountySchema.omit({ funding: true });
const RadarOutputSchema = z.object({ drafts: z.array(RadarModelDraftSchema).max(5) });

export function radarJsonSchema(): JsonSchema {
  const js = z.toJSONSchema(RadarOutputSchema) as JsonSchema;
  delete js.$schema;
  return closeObjects(js);
}

export async function radarDrafts(args: {
  lat: number;
  lng: number;
  radiusKm: number;
  alerts: NwsAlert[];
  protocols: { slug: string; name: string; why_it_matters: string }[];
  /** Grokbot: sponsor-pool summary so the model proposes scopes the allocator can fund. */
  poolSummary?: string;
}): Promise<DraftBounty[]> {
  const slugs = new Set(args.protocols.map((p) => p.slug));
  const alertSummary = args.alerts.map((a) => ({ event: a.event, severity: a.severity, headline: a.headline, onset: a.onset, expires: a.expires }));
  const system = [
    "You are the Opportunity Radar for GroundTruth, a paid network that collects verified street-level observations for researchers.",
    "Find places and times where ground-truth data would be scarce and valuable in the next hours, using the NWS alerts provided and recent X posts and web reports (use the x_search and web_search tools).",
    `Only use these protocols (protocol_slug must be one of them): ${JSON.stringify(args.protocols)}.`,
    "Safety first: never center a bounty inside an area under a life-threatening warning (e.g. Flash Flood Emergency, Tornado Warning); prefer the safe edges and the after-the-event window.",
    "Return at most 3 drafts. Each needs a concrete center (lat/lng) near the requested region, a radius in meters (300-3000), a two-sentence summary for contributors, a rationale citing evidence, and source URLs.",
    ...(args.poolSummary ? [args.poolSummary] : []),
  ].join(" ");
  const out = await grokJSON({
    op: "radar_scan",
    model: grokEnv.reasoningModel,
    system,
    content: [
      {
        type: "input_text",
        text: `Region: ${args.lat.toFixed(4)}, ${args.lng.toFixed(4)}, radius ${args.radiusKm} km. Active NWS alerts at the center: ${JSON.stringify(alertSummary)}. Current time: ${new Date().toISOString()}.`,
      },
    ],
    schema: radarJsonSchema(),
    name: "radar_drafts",
    parse: (raw) => RadarOutputSchema.parse(raw),
    tools: [{ type: "x_search" }, { type: "web_search" }],
    timeoutMs: 180_000,
    mock: () => ({ drafts: mockRadarDrafts(args.lat, args.lng, args.alerts.map((a) => a.event)) }),
  });
  return out.drafts.filter((d) => slugs.has(d.protocol_slug));
}
