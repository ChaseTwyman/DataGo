/**
 * Revisit missions + late (queued) uploads, end to end through the real route handlers on PGlite
 * (MOCK_GROK, local backend, DEMO_MODE). Mission windows are +25..+50 min after a capture, so tests
 * move a mission's window to "now" in the DB instead of waiting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BountyMissionsResponseSchema,
  cellCenter,
  CreateSessionResponseSchema,
  DEMO,
  LATE_UPLOAD_GRACE_MIN,
  NearbyMissionsResponseSchema,
  NearbyResponseSchema,
  SubmissionWithMediaSchema,
  type CreateSessionResponse,
} from "@groundtruth/shared";
import { captureBackground, drainBackground } from "@/lib/background";
import { setContextFetch } from "@/lib/context/fetcher";
import { devTokenFor } from "@/lib/auth";
import { clearHazardCache } from "@/lib/hazards";
import { getBounty } from "@/lib/db/repos/bounties";
import { onSubmissionAccepted } from "@/lib/missions/service";
import { POST as createSession } from "@/app/api/capture/sessions/route";
import { POST as createSubmission } from "@/app/api/submissions/route";
import { GET as getSubmission } from "@/app/api/submissions/[id]/route";
import { PUT as devUpload } from "@/app/api/dev/upload/route";
import { GET as nearby } from "@/app/api/bounties/nearby/route";
import { GET as missionsNearby } from "@/app/api/missions/route";
import { GET as bountyMissions } from "@/app/api/missions/bounties/[id]/route";
import { idCtx, newContributor, passGate, randomJpeg, req, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
const noCtx = undefined as unknown;
let cells: string[] = [];
let cellIdx = 0;
const researcherToken = () => devTokenFor(DEMO.researcherId);

beforeAll(async () => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  vi.stubEnv("DEMO_MODE", "1");
  env = await setupTestEnv();
  captureBackground();
  setContextFetch(async () => Response.json({ features: [] }));
  cells = (await getBounty(env.db, DEMO.bountyId))!.cells;
}, 60_000);
afterAll(async () => {
  setContextFetch(null);
  vi.unstubAllEnvs();
  await env.close();
});
beforeEach(() => clearHazardCache());

/** A fresh cell of the demo bounty per test, so chains never interfere. */
function nextCell(): { cell: string; lat: number; lng: number } {
  const cell = cells[cellIdx++ % cells.length]!;
  return { cell, ...cellCenter(cell) };
}

async function openSession(token: string, at: { lat: number; lng: number }, gate = true): Promise<CreateSessionResponse> {
  const r = await createSession(
    req("POST", "/api/capture/sessions", { token, body: { bounty_id: DEMO.bountyId, lat: at.lat, lng: at.lng, accuracy_m: 5 } }),
    noCtx,
  );
  expect(r.status).toBe(201);
  const s = CreateSessionResponseSchema.parse(await r.json());
  if (gate) await passGate(token, s.session_id);
  for (const u of s.uploads) {
    const url = new URL(u.signed_url);
    expect((await devUpload(req("PUT", url.pathname + url.search, { raw: await randomJpeg() }), noCtx)).status).toBe(200);
  }
  return s;
}

function body(s: CreateSessionResponse, at: { lat: number; lng: number }, capturedAt = new Date().toISOString()) {
  return {
    session_id: s.session_id,
    nonce: s.nonce,
    media: s.uploads.map((u) => ({ path: u.path, width: 640, height: 480, captured_at: capturedAt })),
    lat: at.lat,
    lng: at.lng,
    accuracy_m: 5,
    captured_at: capturedAt,
    device: { model: "iPhone 16", os: "ios", os_version: "26.0", app_version: "0.1.0" },
    sensors: { tilt_deg: 3, rotation_rate: 0.1, steady: true },
    field_notes: { water_state: "still", debris_present: false },
    gate: { degraded: false, frame_checks: 2, consecutive_green: 2, last_hint: null },
  };
}

async function submit(token: string, s: CreateSessionResponse, at: { lat: number; lng: number }, capturedAt?: string) {
  const r = await createSubmission(req("POST", "/api/submissions", { token, body: body(s, at, capturedAt) }), noCtx);
  if (r.status !== 202) return { status: r.status, error: ((await r.json()) as { error: { code: string } }).error.code, sub: null };
  const { submission_id } = (await r.json()) as { submission_id: string };
  await drainBackground();
  const g = await getSubmission(req("GET", `/api/submissions/${submission_id}`, { token }), idCtx(submission_id));
  return { status: 202, error: null, sub: SubmissionWithMediaSchema.parse(await g.json()) };
}

async function missionsOf(cell: string) {
  return env.db.query<{ id: string; sequence: number; interval_min: number; status: string; original_user_id: string; opens_at: Date; dibs_until: Date; closes_at: Date; due_at: Date; filled_submission_id: string | null }>(
    "select * from public.missions where bounty_id = $1 and cell = $2 order by sequence",
    [DEMO.bountyId, cell],
  );
}

/** Moves mission `seq` of a cell so its window is open now (dibs still running unless `dibsOver`). */
async function openNow(cell: string, seq: number, dibsOver = false) {
  await env.db.query(
    `update public.missions set opens_at = now() - interval '2 minutes', due_at = now() - interval '1 minute',
            dibs_until = now() + ($3 || ' minutes')::interval, closes_at = now() + interval '20 minutes'
      where bounty_id = $1 and cell = $2 and sequence = $4`,
    [DEMO.bountyId, cell, dibsOver ? "-1" : "8", seq],
  );
}

describe("revisit missions", () => {
  it("an accepted flood reading creates +30/+60/+120 missions on its cell with first dibs", async () => {
    const a = await newContributor(env.db);
    const at = nextCell();
    const s = await openSession(a.token, at);
    const { sub } = await submit(a.token, s, at);
    expect(sub!.status).toBe("accepted");
    const ms = await missionsOf(at.cell);
    expect(ms.map((m) => m.interval_min)).toEqual([30, 60, 120]);
    expect(ms.every((m) => m.status === "open" && m.original_user_id === a.id)).toBe(true);
    const t0 = Date.parse(sub!.captured_at);
    const m1 = ms[0]!;
    expect(new Date(m1.due_at).getTime() - t0).toBe(30 * 60_000);
    expect(new Date(m1.opens_at).getTime() - t0).toBe(25 * 60_000);
    expect(new Date(m1.dibs_until).getTime() - new Date(m1.opens_at).getTime()).toBe(10 * 60_000);
    expect(new Date(m1.closes_at).getTime() - t0).toBe(50 * 60_000);
    // idempotent: re-running the hook for the same reading adds nothing
    expect((await onSubmissionAccepted(env.db, sub!.id)).kind).toBe("skipped");
    expect(await missionsOf(at.cell)).toHaveLength(3);
  });

  it("a second accepted reading in a cell with a running chain does not start another chain (cap)", async () => {
    const a = await newContributor(env.db);
    const b = await newContributor(env.db);
    const at = nextCell();
    await submit(a.token, await openSession(a.token, at), at);
    const r = await submit(b.token, await openSession(b.token, at), at);
    expect(r.sub!.status).toBe("accepted");
    expect(await missionsOf(at.cell)).toHaveLength(3);
  });

  it("missions list: the original contributor sees 'yours'; others see it reserved; price shows the revisit reason only to eligible callers", async () => {
    const a = await newContributor(env.db);
    const b = await newContributor(env.db);
    const at = nextCell();
    await submit(a.token, await openSession(a.token, at), at);
    const list = async (token: string) =>
      NearbyMissionsResponseSchema.parse(await (await missionsNearby(req("GET", `/api/missions?lat=${at.lat}&lng=${at.lng}&radius_km=2`, { token }), noCtx)).json())
        .missions.filter((m) => m.cell === at.cell);
    const mine = await list(a.token);
    expect(mine).toHaveLength(3);
    expect(mine[0]).toMatchObject({ yours: true, reserved: false, sequence: 1 });
    const theirs = await list(b.token);
    expect(theirs[0]).toMatchObject({ yours: false, reserved: true });
    // no contributor ids leak
    expect(JSON.stringify(theirs)).not.toContain(a.id);

    await openNow(at.cell, 1);
    const reasonsFor = async (token: string) => {
      const nb = NearbyResponseSchema.parse(await (await nearby(req("GET", `/api/bounties/nearby?lat=${at.lat}&lng=${at.lng}`, { token }), noCtx)).json());
      return nb.bounties.find((x) => x.id === DEMO.bountyId)!.price_reasons;
    };
    expect(await reasonsFor(a.token)).toContain("Revisit due here");
    expect(await reasonsFor(b.token)).not.toContain("Revisit due here");
    await openNow(at.cell, 1, true);
    expect(await reasonsFor(b.token)).toContain("Revisit due here");
  });

  it("the original contributor fills the open mission during first dibs; the reading links revisit_of → root", async () => {
    const a = await newContributor(env.db);
    const b = await newContributor(env.db);
    const at = nextCell();
    const root = (await submit(a.token, await openSession(a.token, at), at)).sub!;
    await openNow(at.cell, 1);
    // someone else during first dibs: accepted as a normal reading, but it does not fill the mission
    const other = (await submit(b.token, await openSession(b.token, at), at)).sub!;
    expect(other.status).toBe("accepted");
    expect((await missionsOf(at.cell))[0]!.status).toBe("open");
    // the original contributor fills it
    const again = (await submit(a.token, await openSession(a.token, at), at)).sub!;
    expect(again.status).toBe("accepted");
    const m = (await missionsOf(at.cell))[0]!;
    expect(m).toMatchObject({ status: "filled", filled_submission_id: again.id });
    const link = await env.db.query<{ revisit_of: string; mission_id: string }>("select revisit_of, mission_id from public.submissions where id = $1", [again.id]);
    expect(link[0]).toEqual({ revisit_of: root.id, mission_id: m.id });
    // the filling reading is paid from the request allocation like any other
    expect(again.payout_cents).toBeGreaterThan(0);

    // after dibs, anyone can fill the next one
    await openNow(at.cell, 2, true);
    const byB = (await submit(b.token, await openSession(b.token, at), at)).sub!;
    expect((await missionsOf(at.cell))[1]).toMatchObject({ status: "filled", filled_submission_id: byB.id });

    // researcher view: missions + a recession series root → revisits
    const r = await bountyMissions(req("GET", `/api/missions/bounties/${DEMO.bountyId}`, { token: researcherToken() }), idCtx(DEMO.bountyId));
    expect(r.status).toBe(200);
    const view = BountyMissionsResponseSchema.parse(await r.json());
    const series = view.recession.find((x) => x.root_submission_id === root.id)!;
    expect(series.field).toBe("depth_cm");
    expect(series.points.map((p) => p.submission_id)).toEqual([root.id, again.id, byB.id]);
    expect(series.points[0]!.minutes).toBe(0);
  });

  it("contributors can't read the researcher mission view", async () => {
    const a = await newContributor(env.db);
    const r = await bountyMissions(req("GET", `/api/missions/bounties/${DEMO.bountyId}`, { token: a.token }), idCtx(DEMO.bountyId));
    expect(r.status).toBe(403);
  });

  it("missions draw on the request allocation: none are created when it can't cover them", async () => {
    const a = await newContributor(env.db);
    const at = nextCell();
    const s = await openSession(a.token, at);
    const before = await env.db.query<{ budget_cents: number; spent_cents: number }>("select budget_cents, spent_cents from public.bounties where id = $1", [DEMO.bountyId]);
    // leave just enough for this reading's payout, nothing for follow-ups
    await env.db.query("update public.bounties set budget_cents = spent_cents + $2 where id = $1", [DEMO.bountyId, Math.ceil(s.price_quote_cents * 1.2)]);
    try {
      const { sub } = await submit(a.token, s, at);
      expect(sub!.status).toBe("accepted");
      expect(await missionsOf(at.cell)).toHaveLength(0);
    } finally {
      await env.db.query("update public.bounties set budget_cents = $2 where id = $1", [DEMO.bountyId, before[0]!.budget_cents]);
    }
  });
});

describe("dataset linkage", () => {
  it("revisit_of is exported to researchers and pseudonymised (like observation_id) in open data", async () => {
    const { flattenExportRow, dataDictionary } = await import("@/lib/export");
    const { coarsen, publicColumns, observationPseudonym } = await import("@/lib/openData");
    const { streetFloodDepth } = await import("@groundtruth/shared");
    const root = "11111111-1111-4111-8111-111111111111";
    const raw = {
      observation_id: "22222222-2222-4222-8222-222222222222",
      bounty_id: DEMO.bountyId,
      protocol_slug: "street-flood-depth",
      protocol_version: 1,
      lat: DEMO.lat,
      lng: DEMO.lng,
      accuracy_m: 5,
      h3_cell: cells[0],
      captured_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
      confidence: 0.9,
      protocol_score: 0.9,
      authenticity_score: 0.9,
      extracted: { depth_cm: 12 },
      field_notes: {},
      reason_codes: [],
      contributor_id: "33333333-3333-4333-8333-333333333333",
      contributor_trust: 0.5,
      device_model: "iPhone",
      device_os: "ios",
      frame_count: 3,
      gate_degraded: false,
      human_reviewed: false,
      verifier: "model",
      quality_tier: "model_high",
      revisit_of: root,
    };
    expect(dataDictionary(streetFloodDepth).some((c) => c.name === "revisit_of")).toBe(true);
    const full = flattenExportRow(raw, streetFloodDepth);
    expect(full.revisit_of).toBe(root);
    const pub = coarsen(full, "salt", "street-flood-depth", publicColumns(streetFloodDepth));
    expect(pub.revisit_of).toBe(observationPseudonym("salt", "street-flood-depth", root));
    expect(JSON.stringify(pub)).not.toContain(root);
    expect(coarsen({ ...full, revisit_of: null }, "salt", "street-flood-depth", publicColumns(streetFloodDepth)).revisit_of).toBeNull();
  });
});

describe("late (queued) uploads", () => {
  /** Shifts a session into the past so it expired `minAgo` minutes ago. */
  async function expireSession(sessionId: string, minAgo: number) {
    await env.db.query(
      `update public.capture_sessions set started_at = now() - (($2 + 15) || ' minutes')::interval,
              expires_at = now() - ($2 || ' minutes')::interval,
              gate_passed_at = case when gate_passed_at is null then null else now() - (($2 + 12) || ' minutes')::interval end
        where id = $1`,
      [sessionId, String(minAgo)],
    );
    const r = await env.db.query<{ started_at: Date; expires_at: Date }>("select started_at, expires_at from public.capture_sessions where id = $1", [sessionId]);
    return { started: new Date(r[0]!.started_at), expires: new Date(r[0]!.expires_at) };
  }

  it("accepts a gate-passed session's capture uploaded after the window, within the grace", async () => {
    const a = await newContributor(env.db);
    const at = nextCell();
    const s = await openSession(a.token, at);
    const w = await expireSession(s.session_id, 30);
    const captured = new Date(w.expires.getTime() - 5 * 60_000).toISOString();
    const r = await submit(a.token, s, at, captured);
    expect(r.status).toBe(202);
    expect(r.sub!.status).toBe("accepted");
    const integrity = r.sub!.checks.find((c) => c.stage === "session_integrity")!;
    expect(integrity.subchecks?.find((x) => x.id === "window")).toMatchObject({ status: "pass" });
    expect(r.sub!.reason_codes).not.toContain("SESSION_EXPIRED");
  });

  it("never gives the grace to a session that never passed the gate", async () => {
    const a = await newContributor(env.db);
    const at = nextCell();
    const s = await openSession(a.token, at, false);
    const w = await expireSession(s.session_id, 30);
    const r = await submit(a.token, s, at, new Date(w.expires.getTime() - 5 * 60_000).toISOString());
    expect(r).toMatchObject({ status: 409, error: "GATE_NOT_PASSED" });
  });

  it("refuses after the grace, and captures timed outside the session", async () => {
    const a = await newContributor(env.db);
    const at = nextCell();
    const s = await openSession(a.token, at);
    const w = await expireSession(s.session_id, LATE_UPLOAD_GRACE_MIN + 5);
    expect(await submit(a.token, s, at, new Date(w.expires.getTime() - 60_000).toISOString())).toMatchObject({ status: 410, error: "UPLOAD_GRACE_EXPIRED" });

    const s2 = await openSession(a.token, at);
    await expireSession(s2.session_id, 30);
    expect(await submit(a.token, s2, at, new Date().toISOString())).toMatchObject({ status: 409, error: "CAPTURE_OUTSIDE_SESSION" });
  });

  it("on-time submissions of never-passed sessions are unchanged (review, never paid)", async () => {
    const a = await newContributor(env.db);
    const at = nextCell();
    const r = await submit(a.token, await openSession(a.token, at, false), at);
    expect(r.sub!.status).toBe("needs_review");
    expect(r.sub!.reason_codes).toContain("GATE_NOT_PASSED");
  });
});
