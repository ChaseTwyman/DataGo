/** seed-open-data (demo/dev): realistic accepted flood rows, idempotent, --reset removes only seeded rows. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cellForPoint, DEMO, pendingChecks } from "@groundtruth/shared";
import { getBounty } from "@/lib/db/repos/bounties";
import { ensureDevUser } from "@/lib/db/repos/profiles";
import { finalizeSubmission, insertSubmission } from "@/lib/db/repos/submissions";
import { getProtocolBySlug } from "@/lib/db/repos/protocols";
import { publicRows } from "@/lib/openData";
import { resetOpenDataSeed, SEED_DEVICE_MODEL, seedOpenData } from "@/lib/openDataSeed";
import { setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
let realId = "";

const count = async (where = "true") =>
  (await env.db.query<{ n: number }>(`select count(*)::int as n from public.submissions where ${where}`))[0]!.n;
const seededWhere = `device->>'model' = '${SEED_DEVICE_MODEL}' and gate->>'seeded' = 'true'`;

beforeAll(async () => {
  env = await setupTestEnv();
  // One real (non-seed) accepted row that --reset must never touch.
  const user = randomUUID();
  await ensureDevUser(env.db, user);
  realId = await insertSubmission(env.db, {
    session_id: null,
    bounty_id: DEMO.bountyId,
    user_id: user,
    media: [],
    lat: DEMO.lat,
    lng: DEMO.lng,
    accuracy_m: 5,
    h3_cell: cellForPoint(DEMO.lat, DEMO.lng),
    captured_at: new Date().toISOString(),
    device: { model: "iPhone 17", os: "ios", os_version: "27", app_version: "0.1.0" },
    sensors: {},
    gate: {},
    field_notes: {},
    checks: pendingChecks(),
  });
  await finalizeSubmission(env.db, realId, {
    status: "accepted", checks: pendingChecks(), reason_codes: [], confidence: 0.9, protocol_score: 0.9,
    authenticity_score: 0.9, extracted: { depth_cm: 10 }, phashes: [], payout_cents: 0, retryable: false,
  });
}, 60_000);
afterAll(async () => env.close());

describe("seedOpenData", () => {
  it("inserts ~40 plausible accepted rows inside the demo bounty, marked as seeded, with no media", async () => {
    const now = new Date();
    const r = await seedOpenData(env.db, { now });
    expect(r.inserted).toBe(40);
    expect(r.skipped).toBe(false);
    const rows = await env.db.query<{
      status: string; h3_cell: string; lat: number; lng: number; media: unknown[]; captured_at: Date | string;
      extracted: Record<string, unknown>; field_notes: Record<string, unknown>; confidence: number; payout_cents: number;
    }>(`select status::text as status, h3_cell, lat, lng, media, captured_at, extracted, field_notes, confidence, payout_cents
          from public.submissions where ${seededWhere}`);
    expect(rows).toHaveLength(40);
    const bounty = (await getBounty(env.db, DEMO.bountyId))!;
    const depths = rows.map((x) => Number(x.extracted.depth_cm));
    for (const x of rows) {
      expect(x.status).toBe("accepted");
      expect(x.media).toEqual([]);
      expect(bounty.cells).toContain(x.h3_cell);
      expect(cellForPoint(x.lat, x.lng)).toBe(x.h3_cell);
      const age = now.getTime() - new Date(x.captured_at).getTime();
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThanOrEqual(6 * 3600_000);
      expect(x.confidence).toBeGreaterThanOrEqual(0.7);
      expect(x.confidence).toBeLessThanOrEqual(0.97);
      expect(x.payout_cents).toBe(0);
      expect(["still", "slow", "fast"]).toContain(x.extracted.water_state);
      expect(x.field_notes.water_state).toBe(x.extracted.water_state);
      // the reference object must be tall enough to gauge the depth
      expect(Number(x.extracted.reference_object_assumed_height_cm)).toBeGreaterThanOrEqual(Math.min(Number(x.extracted.depth_cm), 75));
    }
    // plausible, varied depths
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...depths)).toBeLessThanOrEqual(90);
    expect(new Set(depths).size).toBeGreaterThan(15);
    expect(new Set(rows.map((x) => x.h3_cell)).size).toBeGreaterThan(8);
    expect(new Set(rows.map((x) => x.extracted.reference_object_type)).size).toBeGreaterThan(2);
  });

  it("is idempotent: a second run inserts nothing", async () => {
    const r = await seedOpenData(env.db);
    expect(r).toEqual({ inserted: 0, skipped: true });
    expect(await count(seededWhere)).toBe(40);
  });

  it("seeded rows show up in the public dataset flagged is_demo_seed", async () => {
    const protocol = (await getProtocolBySlug(env.db, "street-flood-depth"))!;
    const rows = await publicRows(env.db, protocol);
    expect(rows).toHaveLength(41);
    expect(rows.filter((r) => r.is_demo_seed === true)).toHaveLength(40);
  });

  it("--reset removes only seeded rows; seeding works again afterwards", async () => {
    const removed = await resetOpenDataSeed(env.db);
    expect(removed).toBe(40);
    expect(await count(seededWhere)).toBe(0);
    expect(await count(`id = '${realId}'`)).toBe(1);
    expect((await seedOpenData(env.db)).inserted).toBe(40);
  });

  it("refuses a missing bounty", async () => {
    await expect(seedOpenData(env.db, { bountyId: randomUUID() })).rejects.toThrow(/not found/);
  });
});
