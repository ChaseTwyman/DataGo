/**
 * DEMO/DEV ONLY: fills the demo bounty with ~40 realistic accepted flood observations so the open-data
 * page has something to show. Rows are clearly marked (device.model = "seed-script", gate.seeded = true,
 * reason code DEMO_WAIVER) and appear with is_demo_seed = true in the public dataset.
 *
 * No media: fabricating images for "accepted observations" would put generated pixels in the
 * observations bucket (same rule as spawn-event). No payouts, no budget spend, no ledger entries.
 * Deterministic PRNG, so the same rows come back after --reset (timestamps are relative to `now`).
 */
import { cellCenter, cellForPoint, DEMO, haversineM } from "@groundtruth/shared";
import type { Db } from "./db";
import { json } from "./db/types";
import { getBounty } from "./db/repos/bounties";
import { ensureDevUser } from "./db/repos/profiles";
import { seedChecks } from "./demo";

export const SEED_DEVICE_MODEL = "seed-script";
const SEEDED = `device->>'model' = '${SEED_DEVICE_MODEL}' and gate->>'seeded' = 'true'`;

/** Nine fixed pseudo-contributors (some capture several rows, like real volunteers). */
export const SEED_CONTRIBUTORS = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-0000000005e${i}`);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ref = "curb" | "tire" | "hydrant" | "sign_post" | "measuring_stick";
const REF_HEIGHT: Record<Ref, number> = { curb: 15, tire: 65, hydrant: 75, sign_post: 210, measuring_stick: 100 };
const REF_NOTE: Record<Ref, (d: number, h: number) => string> = {
  curb: (d, h) => (d >= h ? "Curb fully submerged; water spreading onto the sidewalk." : `Water about ${Math.round((d / h) * 100)}% up the curb face.`),
  tire: (d, h) => `Water roughly ${Math.round((d / h) * 100)}% up a parked car's tire.`,
  hydrant: (d) => `Water around the hydrant base, ~${d} cm on the barrel.`,
  sign_post: (d) => `Sign post standing in ~${d} cm of water.`,
  measuring_stick: (d) => `Measuring stick reads ${d} cm.`,
};

export interface SeedResult {
  inserted: number;
  skipped: boolean;
}

export async function seedOpenData(
  db: Db,
  opts: { bountyId?: string; count?: number; now?: Date } = {},
): Promise<SeedResult> {
  const bountyId = opts.bountyId ?? DEMO.bountyId;
  const n = opts.count ?? 40;
  const now = opts.now ?? new Date();
  const bounty = await getBounty(db, bountyId);
  if (!bounty) throw new Error(`bounty ${bountyId} not found`);
  if (bounty.cells.length === 0) throw new Error(`bounty ${bountyId} has no cells`);

  const existing = await db.query<{ n: number }>(`select count(*)::int as n from public.submissions where bounty_id = $1 and ${SEEDED}`, [bountyId]);
  if ((existing[0]?.n ?? 0) > 0) return { inserted: 0, skipped: true };

  for (const id of SEED_CONTRIBUTORS) await ensureDevUser(db, id, "contributor");

  const rand = mulberry32(0x6e7d_2026);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  // A low spot SE of the centre collects the deepest water; depth decays with distance from it.
  const low = { lat: bounty.center_lat - 0.0025, lng: bounty.center_lng + 0.002 };
  const cells = new Set(bounty.cells);

  await db.tx(async (tx) => {
    for (let i = 0; i < n; i++) {
      const cell = pick(bounty.cells);
      const c = cellCenter(cell);
      let lat = c.lat + (rand() - 0.5) * 0.0006;
      let lng = c.lng + (rand() - 0.5) * 0.0006;
      let h3 = cellForPoint(lat, lng);
      if (!cells.has(h3)) {
        ({ lat, lng } = c);
        h3 = cell;
      }
      const dist = haversineM(lat, lng, low.lat, low.lng);
      const depth = Math.round(Math.min(85, Math.max(2, (6 + 48 * Math.exp(-dist / 420)) * Math.exp(0.3 * gauss()))));
      const ref: Ref =
        depth <= 14 ? (rand() < 0.85 ? "curb" : "measuring_stick")
        // a 15 cm curb can't gauge deeper water, so deeper rows use taller references
        : depth <= 45 ? pick(["tire", "tire", "hydrant", "measuring_stick"] as const)
        : depth <= 60 ? pick(["hydrant", "sign_post", "tire"] as const)
        : depth <= 75 ? pick(["hydrant", "sign_post"] as const)
        : "sign_post";
      const refHeight = REF_HEIGHT[ref];
      const water = depth < 10 ? (rand() < 0.8 ? "still" : "slow") : depth < 30 ? pick(["still", "slow", "slow"] as const) : pick(["slow", "fast", "fast"] as const);
      const debris = rand() < 0.15 + depth / 120;
      const surface = rand() < 0.7 ? "road" : pick(["sidewalk", "sidewalk", "parking_lot", "yard"] as const);
      const depthConf = ref === "measuring_stick" ? 0.9 : ref === "curb" ? 0.8 : 0.6 + rand() * 0.15;
      const ageMs = 6 * 3600_000 * Math.pow(rand(), 1.6); // denser toward now
      const captured = new Date(now.getTime() - Math.max(60_000, ageMs));
      const protocolScore = 0.78 + rand() * 0.19;
      const authenticity = 0.82 + rand() * 0.15;
      const confidence = Math.min(0.97, Math.max(0.7, 0.45 * protocolScore + 0.45 * authenticity + 0.05 + (rand() - 0.5) * 0.04));
      const r3 = (x: number) => Math.round(x * 1000) / 1000;

      await tx.query(
        `insert into public.submissions (session_id, bounty_id, user_id, media, lat, lng, accuracy_m, h3_cell, captured_at, received_at,
           device, sensors, gate, field_notes, status, checks, reason_codes, confidence, protocol_score, authenticity_score,
           extracted, phashes, payout_cents, retryable)
         values (null, $1, $2, '[]'::jsonb, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz,
           $9::jsonb, '{}'::jsonb, $10::jsonb, $11::jsonb, 'accepted', $12::jsonb, $13::text[], $14, $15, $16,
           $17::jsonb, '{}'::text[], 0, false)`,
        [
          bountyId, SEED_CONTRIBUTORS[i % SEED_CONTRIBUTORS.length]!, lat, lng, Math.round(4 + rand() * 11), h3,
          captured.toISOString(), new Date(captured.getTime() + 2000 + Math.round(rand() * 25_000)).toISOString(),
          json({ model: SEED_DEVICE_MODEL, os: "seed", os_version: null, app_version: null }),
          json({ seeded: true, degraded: false }),
          json({ water_state: water, debris_present: debris }),
          json(seedChecks()),
          ["DEMO_WAIVER"],
          r3(confidence), r3(protocolScore), r3(authenticity),
          json({
            depth_cm: depth,
            depth_confidence: r3(depthConf),
            reference_object_type: ref,
            reference_object_assumed_height_cm: refHeight,
            surface_type: surface,
            water_state: water,
            debris_present: debris,
            notes: `${REF_NOTE[ref](depth, refHeight)} (seeded demo row)`,
          }),
        ],
      );
    }
  });
  return { inserted: n, skipped: false };
}

/** Deletes only rows this seeder wrote (both markers must match). Returns the number removed. */
export async function resetOpenDataSeed(db: Db, bountyId?: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `delete from public.submissions where ${SEEDED} ${bountyId ? "and bounty_id = $1" : ""} returning id`,
    bountyId ? [bountyId] : [],
  );
  return rows.length;
}
