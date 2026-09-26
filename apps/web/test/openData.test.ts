/**
 * Open data + sponsors on PGlite (real migrations): sponsor fields through the bounty routes, and the
 * public (no-auth) dataset API with its privacy coarsening.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BountyDetailSchema,
  cellCenter,
  cellForPoint,
  DEMO,
  NearbyResponseSchema,
  OPEN_DATA_LICENSE,
  pendingChecks,
  PublicDatasetJsonResponseSchema,
  PublicDatasetListResponseSchema,
  PublicDictionaryResponseSchema,
  streetFloodDepth,
  type Protocol,
} from "@groundtruth/shared";
import { POST as devSession } from "@/app/api/dev/session/route";
import { GET as nearby } from "@/app/api/bounties/nearby/route";
import { GET as bountyGet, PATCH as bountyPatch } from "@/app/api/bounties/[id]/route";
import { POST as createBounty } from "@/app/api/bounties/route";
import { GET as listDatasets } from "@/app/api/public/datasets/route";
import { GET as getDataset } from "@/app/api/public/datasets/[slug]/route";
import { insertBounty } from "@/lib/db/repos/bounties";
import { ensureDevUser } from "@/lib/db/repos/profiles";
import { insertProtocol } from "@/lib/db/repos/protocols";
import { finalizeSubmission, insertSubmission } from "@/lib/db/repos/submissions";
import { cellsForCircle, circlePolygon } from "@groundtruth/shared";
import { idCtx, req, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
let researcher: string;
const noCtx = undefined as unknown;
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

const ALICE = randomUUID();
const BOB = randomUUID();
const SECOND_SLUG = "curb-inlet-blockage";
let secondBountyId = "";
const rawCaptured = new Map<string, string>(); // observation id → raw captured_at

async function addObs(
  bountyId: string,
  userId: string,
  o: {
    status?: "accepted" | "rejected" | "needs_review";
    lat?: number;
    lng?: number;
    minutesAgo?: number;
    media?: boolean;
    depth?: number;
    verifier?: "model" | "mock" | "human" | "none";
    confidence?: number;
  } = {},
): Promise<string> {
  const lat = o.lat ?? DEMO.lat + 0.0011;
  const lng = o.lng ?? DEMO.lng - 0.0007;
  const at = new Date(Date.now() - (o.minutesAgo ?? 30) * 60_000 - 17_345).toISOString();
  const id = await insertSubmission(env.db, {
    session_id: null,
    bounty_id: bountyId,
    user_id: userId,
    media: o.media === false ? [] : [{ path: `observations/${userId}/${randomUUID()}/0.jpg`, width: 640, height: 480, captured_at: at }],
    lat,
    lng,
    accuracy_m: 7.3,
    h3_cell: cellForPoint(lat, lng),
    captured_at: at,
    device: { model: "Pixel 9 Pro", os: "android", os_version: "16", app_version: "0.1.0" },
    sensors: {},
    gate: {},
    field_notes: { water_state: "slow", debris_present: true },
    checks: pendingChecks(),
  });
  await finalizeSubmission(env.db, id, {
    status: o.status ?? "accepted",
    checks: pendingChecks(),
    reason_codes: [],
    confidence: o.confidence ?? 0.84,
    protocol_score: 0.9,
    authenticity_score: 0.93,
    extracted: {
      depth_cm: o.depth ?? 18,
      depth_confidence: 0.7,
      reference_object_type: "curb",
      reference_object_assumed_height_cm: 15,
      surface_type: "road",
      water_state: "slow",
      debris_present: true,
      notes: "Water reaches the top of the curb outside 123 Example St",
    },
    phashes: [],
    payout_cents: 500,
    retryable: false,
    verifier: o.verifier ?? "model",
  });
  rawCaptured.set(id, at);
  return id;
}

beforeAll(async () => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  vi.stubEnv("DEMO_MODE", "1");
  env = await setupTestEnv();
  const r = await devSession(req("POST", "/api/dev/session", { body: { role: "researcher" } }), noCtx);
  researcher = ((await r.json()) as { access_token: string }).access_token;
  await ensureDevUser(env.db, ALICE);
  await ensureDevUser(env.db, BOB);

  // Flood dataset: 3 accepted (2 by Alice), 1 rejected, 1 needs_review.
  await addObs(DEMO.bountyId, ALICE, { minutesAgo: 50, depth: 12 });
  await addObs(DEMO.bountyId, ALICE, { minutesAgo: 20, depth: 25 });
  await addObs(DEMO.bountyId, BOB, { minutesAgo: 10, lat: DEMO.lat - 0.002, lng: DEMO.lng + 0.001 });
  await addObs(DEMO.bountyId, BOB, { status: "rejected" });
  await addObs(DEMO.bountyId, BOB, { status: "needs_review" });

  // A second published protocol + bounty; Alice contributes to both datasets.
  const second: Protocol = { ...streetFloodDepth, slug: SECOND_SLUG, name: "Curb inlet blockage" };
  const pid = await insertProtocol(env.db, second, DEMO.researcherId, "published");
  secondBountyId = await insertBounty(env.db, {
    protocol_id: pid,
    created_by: DEMO.researcherId,
    title: "Inlet survey",
    summary: "",
    area: circlePolygon(DEMO.lat, DEMO.lng, 500),
    center_lat: DEMO.lat,
    center_lng: DEMO.lng,
    radius_m: 500,
    cells: cellsForCircle(DEMO.lat, DEMO.lng, 500),
    starts_at: new Date(Date.now() - 3600_000).toISOString(),
    ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    event_started_at: null,
    base_price_cents: 100,
    max_price_cents: 200,
    target_per_cell: 3,
    priority: 1,
    budget_cents: 10_000,
    status: "active",
    source: "manual",
    sponsor_name: "City Stormwater Office",
    sponsor_url: "https://example.org/stormwater",
  });
  await addObs(secondBountyId, ALICE, { minutesAgo: 5 });

  // A draft protocol's data is never public.
  await insertProtocol(env.db, { ...streetFloodDepth, slug: "draft-thing", name: "Draft thing" }, DEMO.researcherId, "draft");
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await env.close();
});

describe("sponsor fields", () => {
  it("nearby and detail expose the seeded demo sponsor", async () => {
    const c = await devSession(req("POST", "/api/dev/session", { body: { role: "contributor" } }), noCtx);
    const token = ((await c.json()) as { access_token: string }).access_token;
    const n = NearbyResponseSchema.parse(await (await nearby(req("GET", `/api/bounties/nearby?lat=${DEMO.lat}&lng=${DEMO.lng}`, { token }), noCtx)).json());
    const demo = n.bounties.find((b) => b.id === DEMO.bountyId);
    expect(demo?.sponsor_name).toBe(DEMO.sponsorName);
    const d = BountyDetailSchema.parse(await (await bountyGet(req("GET", `/api/bounties/${DEMO.bountyId}`, { token }), idCtx(DEMO.bountyId))).json());
    expect(d.sponsor_name).toBe(DEMO.sponsorName);
  });

  it("create ignores researcher-set sponsors and prices; an admin patch sets and clears the sponsor", async () => {
    const now = Date.now();
    const r = await createBounty(
      req("POST", "/api/bounties", {
        token: researcher,
        body: {
          protocol_id: DEMO.protocolId,
          title: "Sponsored flood survey",
          center_lat: DEMO.lat,
          center_lng: DEMO.lng,
          radius_m: 300,
          starts_at: new Date(now).toISOString(),
          ends_at: new Date(now + 86_400_000).toISOString(),
          base_price_cents: 1,
          max_price_cents: 99_999,
          target_per_cell: 2,
          budget_cents: 99_999_999,
          status: "active",
          sponsor_name: "  Acme Flood Insurance  ",
          sponsor_url: "https://acme.example/flood",
        },
      }),
      noCtx,
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    const d = BountyDetailSchema.parse(await (await bountyGet(req("GET", `/api/bounties/${id}`, { token: researcher }), idCtx(id))).json());
    // a data request: not funded (empty pool here), no self-declared sponsor, platform prices
    expect(d.status).toBe("pending_funding");
    expect(d.budget_cents).toBe(0);
    expect(d.sponsor_name).toBeNull();
    expect(d.base_price_cents).toBe(200);
    expect(d.max_price_cents).toBe(1000);

    const p = await bountyPatch(req("PATCH", `/api/bounties/${id}`, { token: researcher, body: { sponsor_name: "NOAA (demo)", sponsor_url: null } }), idCtx(id));
    expect(p.status).toBe(200);
    const pd = BountyDetailSchema.parse(await p.json());
    expect(pd.sponsor_name).toBe("NOAA (demo)");
    expect(pd.sponsor_url).toBeNull();

    const bad = await bountyPatch(req("PATCH", `/api/bounties/${id}`, { token: researcher, body: { sponsor_url: "not a url" } }), idCtx(id));
    expect(bad.status).toBe(400);
  });
});

async function csvFor(slug: string, query = ""): Promise<{ status: number; headers: Headers; text: string }> {
  const r = await getDataset(req("GET", `/api/public/datasets/${slug}?format=csv${query}`), slugCtx(slug));
  return { status: r.status, headers: r.headers, text: await r.text() };
}

function parseCsv(text: string): Record<string, string>[] {
  // Test data has no quoted commas except the free-text note, which must not be published anyway.
  const [head, ...lines] = text.trim().split("\r\n");
  const cols = head!.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i]!, v])));
}

async function jsonFor(slug: string, query = "") {
  const r = await getDataset(req("GET", `/api/public/datasets/${slug}?format=json${query}`), slugCtx(slug));
  expect(r.status).toBe(200);
  return PublicDatasetJsonResponseSchema.parse(await r.json());
}

describe("GET /api/public/datasets (no auth)", () => {
  it("lists one dataset per published protocol with counts, sponsors, license, citation, cache headers", async () => {
    const r = await listDatasets(req("GET", "/api/public/datasets"), noCtx);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("s-maxage=60");
    const body = PublicDatasetListResponseSchema.parse(await r.json());
    expect(body.license.id).toBe(OPEN_DATA_LICENSE.id);
    const slugs = body.datasets.map((d) => d.slug).sort();
    expect(slugs).toEqual([SECOND_SLUG, "street-flood-depth"].sort());
    const flood = body.datasets.find((d) => d.slug === "street-flood-depth")!;
    expect(flood.rows).toBe(3);
    expect(flood.contributors).toBe(2);
    expect(flood.sponsors.map((s) => s.name)).toContain(DEMO.sponsorName);
    expect(flood.bbox).not.toBeNull();
    expect(flood.time_range).not.toBeNull();
    expect(flood.cells.reduce((a, c) => a + c.rows, 0)).toBe(3);
    expect(flood.citation.text).toContain("GroundTruth contributors");
    expect(flood.citation.bibtex).toMatch(/^@misc\{/);
    expect(flood.downloads.csv).toBe("/api/public/datasets/street-flood-depth?format=csv");
    const second = body.datasets.find((d) => d.slug === SECOND_SLUG)!;
    expect(second.sponsors).toEqual([{ name: "City Stormwater Office", url: "https://example.org/stormwater" }]);
  });
});

describe("GET /api/public/datasets/:slug (no auth)", () => {
  it("CSV: only accepted rows, coarsened, no raw identifiers, no media", async () => {
    const { status, headers, text } = await csvFor("street-flood-depth");
    expect(status).toBe(200);
    expect(headers.get("content-type")).toContain("text/csv");
    expect(headers.get("cache-control")).toContain("s-maxage=60");
    expect(headers.get("content-disposition")).toContain("groundtruth-street-flood-depth");
    const rows = parseCsv(text);
    expect(rows).toHaveLength(3);
    const cols = text.split("\r\n")[0]!.split(",");
    for (const banned of ["accuracy_m", "received_at", "device_model", "contributor_trust", "notes"]) expect(cols).not.toContain(banned);
    for (const needed of ["h3_cell", "gps_accuracy_bucket", "contributor_id", "depth_cm", "is_demo_seed"]) expect(cols).toContain(needed);
    for (const row of rows) {
      const c = cellCenter(row.h3_cell!);
      expect(Number(row.lat)).toBeCloseTo(c.lat, 6);
      expect(Number(row.lng)).toBeCloseTo(c.lng, 6);
      const t = new Date(row.captured_at!);
      expect(t.getUTCMinutes() % 5).toBe(0);
      expect(t.getUTCSeconds()).toBe(0);
      expect(t.getUTCMilliseconds()).toBe(0);
      expect(row.gps_accuracy_bucket).toBe("le_10m");
      expect(row.is_demo_seed).toBe("false");
    }
    for (const leak of [ALICE, BOB, "observations/", "Pixel 9", "Example St", ...rawCaptured.keys(), ...rawCaptured.values()]) {
      expect(text).not.toContain(leak);
    }
  });

  it("captured_at is rounded down to its 5-minute window", async () => {
    const body = await jsonFor("street-flood-depth");
    const raws = [...rawCaptured.values()].map((v) => Date.parse(v));
    for (const row of body.rows) {
      const t = Date.parse(String(row.captured_at));
      // some raw capture time lies within [t, t + 5 min)
      expect(raws.some((r) => r >= t && r < t + 5 * 60_000)).toBe(true);
    }
  });

  it("pseudonyms are stable within a dataset and differ across datasets", async () => {
    const flood = await jsonFor("street-flood-depth");
    const ids = flood.rows.map((r) => String(r.contributor_id));
    expect(new Set(ids).size).toBe(2); // Alice twice, Bob once
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
    const again = await jsonFor("street-flood-depth");
    expect(again.rows.map((r) => r.contributor_id)).toEqual(flood.rows.map((r) => r.contributor_id));

    const second = await jsonFor(SECOND_SLUG);
    expect(second.rows).toHaveLength(1);
    const aliceSecond = String(second.rows[0]!.contributor_id);
    expect(ids).not.toContain(aliceSecond);
  });

  it("GeoJSON: snapped point geometry, same public properties", async () => {
    const r = await getDataset(req("GET", "/api/public/datasets/street-flood-depth?format=geojson"), slugCtx("street-flood-depth"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/geo+json");
    const text = await r.text();
    expect(text).not.toContain("observations/");
    const fc = JSON.parse(text) as { type: string; features: { id: string; geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] };
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(3);
    for (const f of fc.features) {
      const c = cellCenter(String(f.properties.h3_cell));
      expect(f.geometry.coordinates[0]).toBeCloseTo(c.lng, 6);
      expect(f.geometry.coordinates[1]).toBeCloseTo(c.lat, 6);
      expect(f.properties).not.toHaveProperty("accuracy_m");
      expect(f.properties).not.toHaveProperty("device_model");
      expect(f.id).toBe(f.properties.observation_id);
    }
  });

  it("JSON: limit and bounty_id filter", async () => {
    const limited = await jsonFor("street-flood-depth", "&limit=2");
    expect(limited.rows).toHaveLength(2);
    expect(limited.total_rows).toBe(3);
    const filtered = await jsonFor("street-flood-depth", `&bounty_id=${DEMO.bountyId}`);
    expect(filtered.rows).toHaveLength(3);
    expect(filtered.bounty_id).toBe(DEMO.bountyId);
    const wrong = await getDataset(
      req("GET", `/api/public/datasets/street-flood-depth?format=json&bounty_id=${secondBountyId}`),
      slugCtx("street-flood-depth"),
    );
    expect(wrong.status).toBe(404);
  });

  it("dictionary states license, coarsening, provenance and matches the CSV columns", async () => {
    const r = await getDataset(req("GET", "/api/public/datasets/street-flood-depth?format=dictionary"), slugCtx("street-flood-depth"));
    expect(r.status).toBe(200);
    const d = PublicDictionaryResponseSchema.parse(await r.json());
    expect(d.license.id).toBe("CC-BY-4.0");
    expect(d.license_statement).toContain("GroundTruth contributors");
    expect(d.coarsening.join(" ")).toMatch(/H3/);
    expect(d.provenance.length).toBeGreaterThan(0);
    const { text } = await csvFor("street-flood-depth");
    expect(d.columns.map((c) => c.name)).toEqual(text.split("\r\n")[0]!.split(","));
  });

  it("unknown and draft protocols are 404; bad format is 400", async () => {
    expect((await csvFor("nope")).status).toBe(404);
    expect((await csvFor("draft-thing")).status).toBe(404);
    const bad = await getDataset(req("GET", "/api/public/datasets/street-flood-depth?format=xlsx"), slugCtx("street-flood-depth"));
    expect(bad.status).toBe(400);
  });

  it("synthetic media can never reach a public dataset", async () => {
    // Structural guard: the DB refuses submissions referencing anything outside the observations bucket.
    await expect(
      insertSubmission(env.db, {
        session_id: null,
        bounty_id: DEMO.bountyId,
        user_id: ALICE,
        media: [{ path: "synthetic/redteam/fake.jpg", width: 1, height: 1, captured_at: new Date().toISOString() }],
        lat: DEMO.lat,
        lng: DEMO.lng,
        accuracy_m: 5,
        h3_cell: cellForPoint(DEMO.lat, DEMO.lng),
        captured_at: new Date().toISOString(),
        device: {},
        sensors: {},
        gate: {},
        field_notes: {},
        checks: pendingChecks(),
      }),
    ).rejects.toThrow(/SYNTHETIC_MEDIA/);
    // And no public format ever carries a media path or bucket name.
    for (const format of ["csv", "geojson", "json", "dictionary"]) {
      const r = await getDataset(req("GET", `/api/public/datasets/street-flood-depth?format=${format}`), slugCtx("street-flood-depth"));
      const text = await r.text();
      expect(text).not.toMatch(/synthetic\/|observations\/|\.jpg/);
    }
  });
});
