/** Researcher-side routes on PGlite: review queue, export, red team, demo spawn, hazards, budget. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CoverageResponseSchema,
  CreateSessionResponseSchema,
  DEMO,
  RedteamRunResponseSchema,
  SubmissionWithMediaSchema,
  type CreateSessionResponse,
} from "@groundtruth/shared";
import { captureBackground, drainBackground } from "@/lib/background";
import { setContextFetch } from "@/lib/context/fetcher";
import { clearHazardCache } from "@/lib/hazards";
import { upsertAlerts } from "@/lib/db/repos/alerts";
import { getProfile } from "@/lib/db/repos/profiles";
import { wallet } from "@/lib/db/repos/ledger";
import { dataDictionary, toCsv } from "@/lib/export";
import { POST as devSession } from "@/app/api/dev/session/route";
import { PUT as devUpload } from "@/app/api/dev/upload/route";
import { POST as createSession } from "@/app/api/capture/sessions/route";
import { POST as createSubmission, GET as listSubs } from "@/app/api/submissions/route";
import { POST as review } from "@/app/api/submissions/[id]/review/route";
import { GET as exportGet } from "@/app/api/bounties/[id]/export/route";
import { GET as coverage } from "@/app/api/bounties/[id]/coverage/route";
import { PATCH as patchBounty } from "@/app/api/bounties/[id]/route";
import { POST as createBounty } from "@/app/api/bounties/route";
import { POST as redteamRun } from "@/app/api/redteam/run/route";
import { GET as redteamRuns } from "@/app/api/redteam/runs/route";
import { POST as exampleImage } from "@/app/api/protocols/[id]/example-image/route";
import { POST as spawn } from "@/app/api/demo/spawn-event/route";
import { streetFloodDepth } from "@groundtruth/shared";
import { idCtx, randomJpeg, req, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
let researcher: string;
const noCtx = undefined as unknown;

beforeAll(async () => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  vi.stubEnv("DEMO_MODE", "1");
  env = await setupTestEnv();
  captureBackground();
  setContextFetch(async () => Response.json({ features: [] }));
  const r = await devSession(req("POST", "/api/dev/session", { body: { role: "researcher" } }), noCtx);
  researcher = ((await r.json()) as { access_token: string }).access_token;
}, 60_000);
afterAll(async () => {
  setContextFetch(null);
  vi.unstubAllEnvs();
  await env.close();
});
beforeEach(() => clearHazardCache());

async function contributor(): Promise<{ token: string; id: string }> {
  const r = await devSession(req("POST", "/api/dev/session", { body: { role: "contributor" } }), noCtx);
  const b = (await r.json()) as { access_token: string; user_id: string };
  return { token: b.access_token, id: b.user_id };
}

async function capture(token: string, bountyId: string = DEMO.bountyId, headers: Record<string, string> = {}, lat: number = DEMO.lat, lng: number = DEMO.lng) {
  const r = await createSession(req("POST", "/api/capture/sessions", { token, body: { bounty_id: bountyId, lat, lng, accuracy_m: 5 } }), noCtx);
  if (r.status !== 201) return { status: r.status, body: await r.json() };
  const s: CreateSessionResponse = CreateSessionResponseSchema.parse(await r.json());
  for (const u of s.uploads) {
    const url = new URL(u.signed_url);
    await devUpload(req("PUT", url.pathname + url.search, { raw: await randomJpeg() }), noCtx);
  }
  const at = new Date().toISOString();
  const body = {
    session_id: s.session_id,
    nonce: s.nonce,
    media: s.uploads.map((u) => ({ path: u.path, captured_at: at })),
    lat,
    lng,
    accuracy_m: 5,
    captured_at: at,
    device: { model: "iPhone", os: "ios", os_version: "26", app_version: "0.1" },
    sensors: { tilt_deg: 2, rotation_rate: 0.1, steady: true },
    field_notes: { water_state: "slow", debris_present: true },
    gate: { degraded: false, frame_checks: 3, consecutive_green: 2, last_hint: null },
  };
  const sub = await createSubmission(req("POST", "/api/submissions", { token, body, headers }), noCtx);
  const { submission_id } = (await sub.json()) as { submission_id: string };
  await drainBackground();
  return { status: 201, submission_id, session: s };
}

describe("review queue", () => {
  it("approve pays the locked quote, writes the ledger, and raises trust", async () => {
    const c = await contributor();
    const r = await capture(c.token, DEMO.bountyId, { "x-mock-variant": "error" });
    const list = await listSubs(req("GET", `/api/submissions?status=needs_review&bounty_id=${DEMO.bountyId}`, { token: researcher }), noCtx);
    const subs = ((await list.json()) as { submissions: unknown[] }).submissions.map((s) => SubmissionWithMediaSchema.parse(s));
    expect(subs.map((s) => s.id)).toContain(r.submission_id);

    const before = (await getProfile(env.db, c.id))!.trust_score;
    const res = await review(req("POST", `/api/submissions/${r.submission_id}/review`, { token: researcher, body: { decision: "approve" } }), idCtx(r.submission_id!));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; payout_cents: number };
    expect(body.status).toBe("accepted");
    expect(body.payout_cents).toBeGreaterThan(0);
    const w = await wallet(env.db, c.id);
    expect(w.balance_cents).toBe(body.payout_cents);
    expect((await getProfile(env.db, c.id))!.trust_score).toBeCloseTo(before + 0.02);

    const again = await review(req("POST", `/api/submissions/${r.submission_id}/review`, { token: researcher, body: { decision: "approve" } }), idCtx(r.submission_id!));
    expect(again.status).toBe(409);
  });

  it("integrity reject costs 0.25 trust and pays nothing; contributors cannot review", async () => {
    const c = await contributor();
    const r = await capture(c.token, DEMO.bountyId, { "x-mock-variant": "error" });
    const denied = await review(req("POST", `/api/submissions/${r.submission_id}/review`, { token: c.token, body: { decision: "approve" } }), idCtx(r.submission_id!));
    expect(denied.status).toBe(403);
    const before = (await getProfile(env.db, c.id))!.trust_score;
    const res = await review(
      req("POST", `/api/submissions/${r.submission_id}/review`, { token: researcher, body: { decision: "reject", integrity: true } }),
      idCtx(r.submission_id!),
    );
    expect(((await res.json()) as { status: string }).status).toBe("rejected");
    expect((await getProfile(env.db, c.id))!.trust_score).toBeCloseTo(before - 0.25);
    expect((await wallet(env.db, c.id)).balance_cents).toBe(0);
  });
});

describe("export", () => {
  it("CSV flattens extraction fields and field notes per the protocol; GeoJSON has points; dictionary lists columns", async () => {
    const c = await contributor();
    await capture(c.token);
    const csv = await exportGet(req("GET", `/api/bounties/${DEMO.bountyId}/export?format=csv`, { token: researcher }), idCtx(DEMO.bountyId));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    const [header, ...lines] = text.trim().split("\r\n");
    const cols = header!.split(",");
    expect(cols).toEqual(expect.arrayContaining(["observation_id", "depth_cm", "reference_object_type", "note_water_state", "note_debris_present", "confidence"]));
    expect(cols.some((c) => /path|media|url/.test(c))).toBe(false);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const row = lines.at(-1)!.split(",");
    expect(row[cols.indexOf("depth_cm")]).toBe("12");
    expect(row[cols.indexOf("note_water_state")]).toBe("slow");

    const gj = await exportGet(req("GET", `/api/bounties/${DEMO.bountyId}/export?format=geojson`, { token: researcher }), idCtx(DEMO.bountyId));
    const fc = (await gj.json()) as { type: string; features: { geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown> }[] };
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0]!.geometry.type).toBe("Point");
    expect(fc.features.at(-1)!.properties.depth_cm).toBe(12);

    const dict = await exportGet(req("GET", `/api/bounties/${DEMO.bountyId}/export?format=dictionary`, { token: researcher }), idCtx(DEMO.bountyId));
    const d = (await dict.json()) as { columns: { name: string; type: string; source: string }[] };
    expect(d.columns.find((x) => x.name === "depth_cm")).toMatchObject({ type: "number, nullable", source: "extraction" });
    expect(d.columns.find((x) => x.name === "water_state")?.type).toBe("enum(still|slow|fast|unknown)");

    const denied = await exportGet(req("GET", `/api/bounties/${DEMO.bountyId}/export`, { token: c.token }), idCtx(DEMO.bountyId));
    expect(denied.status).toBe(403);
  });

  it("CSV escaping", () => {
    expect(toCsv(["a", "b"], [{ a: 'x,"y"', b: null }])).toBe('a,b\r\n"x,""y""",\r\n');
    expect(dataDictionary(streetFloodDepth).length).toBeGreaterThan(20);
  });
});

describe("red team", () => {
  it("all three attacks are caught, recorded in redteam_runs, and never written to submissions", async () => {
    const c = await contributor();
    await capture(c.token); // an accepted observation to recycle
    const count = async () => (await env.db.query<{ n: number }>("select count(*)::int as n from public.submissions"))[0]!.n;
    const before = await count();
    const expected: Record<string, string> = { ai_generated: "AI_GENERATED_SUSPECTED", recycled: "DUPLICATE", wrong_place_time: "OUTSIDE_AREA" };
    for (const attack of ["ai_generated", "recycled", "wrong_place_time"] as const) {
      const r = await redteamRun(req("POST", "/api/redteam/run", { token: researcher, body: { bounty_id: DEMO.bountyId, attack_type: attack } }), noCtx);
      expect(r.status).toBe(200);
      const body = RedteamRunResponseSchema.parse(await r.json());
      expect(body.caught).toBe(true);
      expect(body.status).toBe("rejected");
      expect(body.reason_codes).toContain(expected[attack]);
      expect(body.image_url).toBeTruthy();
    }
    expect(await count()).toBe(before);
    const runs = (await (await redteamRuns(req("GET", `/api/redteam/runs?bounty_id=${DEMO.bountyId}`, { token: researcher }), noCtx)).json()) as {
      runs: { attack_type: string; caught: boolean }[];
    };
    expect(runs.runs.filter((r) => r.caught).length).toBeGreaterThanOrEqual(3);
    const synth = await env.db.query<{ n: number }>("select count(*)::int as n from public.synthetic_media where kind = 'redteam'");
    expect(synth[0]!.n).toBeGreaterThanOrEqual(2);
  });
});

describe("example image", () => {
  it("stores the image in the synthetic bucket and links it to the protocol", async () => {
    const r = await exampleImage(req("POST", `/api/protocols/${DEMO.protocolId}/example-image`, { token: researcher }), idCtx(DEMO.protocolId));
    const body = (await r.json()) as { path: string; url: string };
    expect(body.path).toBe("synthetic/examples/street-flood-depth-v1.jpg");
    expect(await env.storage.exists(body.path)).toBe(true);
    const row = await env.db.query<{ example_image_path: string }>("select example_image_path from public.protocols where id = $1", [DEMO.protocolId]);
    expect(row[0]!.example_image_path).toBe(body.path);
  });
});

describe("demo spawn-event", () => {
  it("creates an active bounty with event 20 min ago and seeded neighbours (DEMO_MODE only)", async () => {
    const lat = 40.7128;
    const lng = -74.006;
    const r = await spawn(req("POST", "/api/demo/spawn-event", { token: researcher, body: { lat, lng } }), noCtx);
    expect(r.status).toBe(201);
    const body = (await r.json()) as { bounty_id: string; seeded_observations: number };
    expect(body.seeded_observations).toBeGreaterThanOrEqual(2);
    const cov = CoverageResponseSchema.parse(await (await coverage(req("GET", `/api/bounties/${body.bounty_id}/coverage`, { token: researcher }), idCtx(body.bounty_id))).json());
    expect(cov.cells.filter((c) => c.accepted > 0)).toHaveLength(body.seeded_observations);
    // empty cells ~20 min into the event surge to the cap: $2 × 3 × ~1.9 → $10 (×5.0)
    expect(Math.max(...cov.cells.map((c) => c.surge))).toBe(5);

    vi.stubEnv("DEMO_MODE", "0");
    const off = await spawn(req("POST", "/api/demo/spawn-event", { token: researcher, body: { lat, lng } }), noCtx);
    expect(off.status).toBe(404);
    vi.stubEnv("DEMO_MODE", "1");
  });
});

describe("hazard pause and budget", () => {
  async function newBounty(over: Record<string, unknown> = {}): Promise<string> {
    const now = Date.now();
    const r = await createBounty(
      req("POST", "/api/bounties", {
        token: researcher,
        body: {
          protocol_id: DEMO.protocolId,
          title: "Hazard test",
          center_lat: 35.0,
          center_lng: -90.0,
          radius_m: 300,
          starts_at: new Date(now - 3600_000).toISOString(),
          ends_at: new Date(now + 86_400_000).toISOString(),
          event_started_at: new Date(now - 600_000).toISOString(),
          base_price_cents: 200,
          max_price_cents: 1000,
          target_per_cell: 5,
          budget_cents: 5000,
          ...over,
        },
      }),
      noCtx,
    );
    expect(r.status).toBe(201);
    return ((await r.json()) as { id: string }).id;
  }

  it("cells under a Flash Flood Emergency are paused, priced without urgency, and refuse sessions", async () => {
    const id = await newBounty();
    await upsertAlerts(env.db, [
      {
        id: "test-ffe",
        event: "Flash Flood Emergency",
        severity: "Severe",
        headline: "Flash Flood Emergency for test county",
        geometry: { type: "Polygon", coordinates: [[[-90.1, 34.9], [-89.9, 34.9], [-89.9, 35.1], [-90.1, 35.1], [-90.1, 34.9]]] },
        onset: null,
        expires: new Date(Date.now() + 3600_000).toISOString(),
      },
    ]);
    const cov = CoverageResponseSchema.parse(await (await coverage(req("GET", `/api/bounties/${id}/coverage`, { token: researcher }), idCtx(id))).json());
    expect(cov.cells.every((c) => c.paused)).toBe(true);
    expect(cov.cells[0]!.paused_reason).toContain("Flash Flood Emergency");
    expect(cov.cells[0]!.surge).toBe(3); // scarcity ×3, urgency suppressed
    const c = await contributor();
    const s = await capture(c.token, id, {}, 35.0, -90.0);
    expect(s.status).toBe(409);
    expect(s.body).toMatchObject({ error: { code: "HAZARD_PAUSED" } });
    await env.db.query("delete from public.weather_alerts where id = 'test-ffe'");
  });

  it("zone-based NWS alert (no geometry) at the bounty point pauses every cell", async () => {
    setContextFetch(async () => Response.json({ features: [{ geometry: null, properties: { id: "z1", event: "Tornado Warning", severity: "Severe" } }] }));
    const id = await newBounty({ center_lat: 36.0 });
    const cov = CoverageResponseSchema.parse(await (await coverage(req("GET", `/api/bounties/${id}/coverage`, { token: researcher }), idCtx(id))).json());
    expect(cov.cells.every((c) => c.paused && c.paused_reason?.startsWith("Tornado Warning"))).toBe(true);
    setContextFetch(async () => Response.json({ features: [] }));
  });

  it("no new sessions once the budget cannot cover the quote", async () => {
    const id = await newBounty({ center_lat: 37.0, budget_cents: 100 });
    const c = await contributor();
    const s = await capture(c.token, id, {}, 37.0, -90.0);
    expect(s.status).toBe(409);
    expect(s.body).toMatchObject({ error: { code: "BUDGET_EXHAUSTED" } });
    const p = await patchBounty(req("PATCH", `/api/bounties/${id}`, { token: researcher, body: { budget_cents: 10_000 } }), idCtx(id));
    expect(p.status).toBe(200);
    expect((await capture(c.token, id, {}, 37.0, -90.0)).status).toBe(201);
  });
});
