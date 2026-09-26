/**
 * Demo mode helpers (BUILD_PROMPT M8). spawnDemoEvent creates an active flood bounty at the venue
 * with the event 20 minutes old and 2–3 accepted observations in neighbouring cells.
 *
 * Seeded observations deliberately carry NO media: fabricating images for "accepted observations"
 * would put generated pixels in the observations bucket and defeat the synthetic-media guarantee.
 * They are marked device.model = "demo-seed" so they are identifiable in exports.
 */
import { gridDisk } from "h3-js";
import {
  cellForPoint,
  cellCenter,
  cellsForCircle,
  circlePolygon,
  DEMO,
  pendingChecks,
  type StageResult,
} from "@groundtruth/shared";
import type { Db } from "./db";
import { insertBounty } from "./db/repos/bounties";
import { ensureDevUser } from "./db/repos/profiles";
import { getProtocol, getProtocolBySlug } from "./db/repos/protocols";
import { finalizeSubmission, insertSubmission } from "./db/repos/submissions";
import { generateExampleImage } from "./examples";
import type { ObjectStorage } from "./storage";

export const DEMO_SEED_USER_ID = "00000000-0000-4000-8000-0000000000d1";

const seedChecks = (): StageResult[] =>
  pendingChecks().map((c) => ({
    ...c,
    status: c.stage === "session_integrity" ? "skipped" : "pass",
    score: c.stage === "session_integrity" ? null : 0.9,
    evidence: ["Seeded demo observation"],
    ...(c.stage === "context" ? { reasonCodes: ["DEMO_WAIVER"] } : {}),
  }));

export async function spawnDemoEvent(
  db: Db,
  storage: ObjectStorage,
  args: { lat: number; lng: number; radius_m: number; createdBy: string; now?: Date },
): Promise<{ bounty_id: string; seeded_observations: number }> {
  const now = args.now ?? new Date();
  const protocol = (await getProtocol(db, DEMO.protocolId)) ?? (await getProtocolBySlug(db, "street-flood-depth"));
  if (!protocol) throw new Error("flood protocol missing: run demo:reset");
  const cells = cellsForCircle(args.lat, args.lng, args.radius_m);
  const bountyId = await insertBounty(db, {
    protocol_id: protocol.id,
    created_by: args.createdBy,
    title: "Flash flood: street depth (live demo)",
    summary: DEMO.summary,
    area: circlePolygon(args.lat, args.lng, args.radius_m),
    center_lat: args.lat,
    center_lng: args.lng,
    radius_m: args.radius_m,
    cells,
    starts_at: new Date(now.getTime() - 3600_000).toISOString(),
    ends_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    event_started_at: new Date(now.getTime() - 20 * 60_000).toISOString(),
    base_price_cents: DEMO.baseCents,
    max_price_cents: DEMO.maxCents,
    target_per_cell: DEMO.targetPerCell,
    priority: 1,
    budget_cents: DEMO.budgetCents,
    status: "active",
    source: "demo",
    sponsor_name: DEMO.sponsorName,
    sponsor_url: DEMO.sponsorUrl,
  });

  await ensureDevUser(db, DEMO_SEED_USER_ID, "contributor");
  const center = cellForPoint(args.lat, args.lng);
  const neighbours = gridDisk(center, 1).filter((c) => c !== center && cells.includes(c)).slice(0, 3);
  const depths = [14, 22, 9];
  for (const [i, cell] of neighbours.entries()) {
    const p = cellCenter(cell);
    const at = new Date(now.getTime() - (10 + i * 4) * 60_000).toISOString();
    const id = await insertSubmission(db, {
      session_id: null,
      bounty_id: bountyId,
      user_id: DEMO_SEED_USER_ID,
      media: [],
      lat: p.lat,
      lng: p.lng,
      accuracy_m: 8,
      h3_cell: cell,
      captured_at: at,
      device: { model: "demo-seed", os: "demo", os_version: null, app_version: null },
      sensors: {},
      gate: {},
      field_notes: { water_state: "still", debris_present: i === 1 },
      checks: pendingChecks(),
    });
    await finalizeSubmission(db, id, {
      status: "accepted",
      checks: seedChecks(),
      reason_codes: ["DEMO_WAIVER"],
      confidence: 0.86,
      protocol_score: 0.88,
      authenticity_score: 0.9,
      extracted: {
        depth_cm: depths[i] ?? 12,
        depth_confidence: 0.7,
        reference_object_type: "curb",
        reference_object_assumed_height_cm: 15,
        surface_type: "road",
        water_state: "still",
        debris_present: i === 1,
        notes: "Seeded demo observation",
      },
      phashes: [],
      payout_cents: 0,
      retryable: false,
    });
  }

  try {
    await generateExampleImage(db, storage, protocol);
  } catch (err) {
    console.warn("[demo] example image generation failed:", err instanceof Error ? err.message : err);
  }
  return { bounty_id: bountyId, seeded_observations: neighbours.length };
}
