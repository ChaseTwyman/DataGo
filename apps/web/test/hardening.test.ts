/**
 * Verification hardening after the vitamin-water incident, through the real route handlers on PGlite:
 * server-side capture gate, relevance (OFF_TOPIC), extraction sanity, verifier provenance, exports and
 * publishing rules, and the MOCK_GROK guard. The incident itself is replayed end to end at the bottom.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CreateSessionResponseSchema,
  DEMO,
  FrameCheckResponseSchema,
  pendingChecks,
  PublicDatasetListResponseSchema,
  streetFloodDepth,
  SubmissionWithMediaSchema,
  WalletResponseSchema,
  type CreateSessionResponse,
} from "@groundtruth/shared";
import { captureBackground, drainBackground } from "@/lib/background";
import { setContextFetch } from "@/lib/context/fetcher";
import { clearHazardCache } from "@/lib/hazards";
import { getDb, setDbForTests } from "@/lib/db";
import { openPostgres } from "@/lib/db/postgres";
import { getProtocolBySlug } from "@/lib/db/repos/protocols";
import { ensureDevUser } from "@/lib/db/repos/profiles";
import { finalizeSubmission, getSubmission, insertSubmission } from "@/lib/db/repos/submissions";
import { assertMockGrokAllowed, frameChecksCountTowardGate, MockOnRealDbError } from "@/lib/env";
import { recordFrameCheck } from "@/lib/db/repos/sessions";
import { exportRows } from "@/lib/export";
import { mockRelevance, mockVerification } from "@/lib/grok/mocks/fixtures";
import { datasetSummary, publicRows } from "@/lib/openData";
import { isolatedDeps, setPipelineDepsOverrideForTests } from "@/lib/verification/deps";
import { memorySink, runPipeline } from "@/lib/verification/pipeline";
import type { PipelineDeps, PipelineInput } from "@/lib/verification/types";
import { POST as devSession } from "@/app/api/dev/session/route";
import { PUT as devUpload } from "@/app/api/dev/upload/route";
import { POST as createSession } from "@/app/api/capture/sessions/route";
import { POST as frameCheck } from "@/app/api/capture/frame-check/route";
import { POST as createSubmission } from "@/app/api/submissions/route";
import { GET as getSubmissionRoute } from "@/app/api/submissions/[id]/route";
import { POST as review } from "@/app/api/submissions/[id]/review/route";
import { GET as walletGet } from "@/app/api/me/wallet/route";
import { GET as exportGet } from "@/app/api/bounties/[id]/export/route";
import { GET as listDatasets } from "@/app/api/public/datasets/route";
import { idCtx, passGate, randomJpeg, req, setupTestEnv, type TestEnv } from "./helpers";
import { cellForPoint, cellsForCircle, circlePolygon } from "@groundtruth/shared";

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
  setPipelineDepsOverrideForTests(null);
  vi.unstubAllEnvs();
  await env.close();
});
afterEach(() => {
  setPipelineDepsOverrideForTests(null);
  clearHazardCache();
});

async function contributor(): Promise<{ token: string; id: string }> {
  const r = await devSession(req("POST", "/api/dev/session", { body: { role: "contributor" } }), noCtx);
  const b = (await r.json()) as { access_token: string; user_id: string };
  return { token: b.access_token, id: b.user_id };
}

async function openSession(token: string): Promise<CreateSessionResponse> {
  const r = await createSession(
    req("POST", "/api/capture/sessions", { token, body: { bounty_id: DEMO.bountyId, lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5 } }),
    noCtx,
  );
  expect(r.status).toBe(201);
  const s = CreateSessionResponseSchema.parse(await r.json());
  for (const u of s.uploads) {
    const url = new URL(u.signed_url);
    await devUpload(req("PUT", url.pathname + url.search, { raw: await randomJpeg() }), noCtx);
  }
  return s;
}

async function check(token: string, sessionId: string, variant?: string) {
  const img = (await randomJpeg(320, 240)).toString("base64");
  const r = await frameCheck(
    req("POST", "/api/capture/frame-check", { token, body: { session_id: sessionId, image_base64: img }, headers: variant ? { "x-mock-variant": variant } : {} }),
    noCtx,
  );
  return { status: r.status, body: r.status === 200 ? FrameCheckResponseSchema.parse(await r.json()) : await r.json() };
}

async function submit(token: string, s: CreateSessionResponse, opts: { variant?: string; gate?: Record<string, unknown> } = {}) {
  const at = new Date().toISOString();
  const body = {
    session_id: s.session_id,
    nonce: s.nonce,
    media: s.uploads.map((u) => ({ path: u.path, width: 640, height: 480, captured_at: at })),
    lat: DEMO.lat,
    lng: DEMO.lng,
    accuracy_m: 5,
    captured_at: at,
    device: { model: "iPhone 16", os: "ios", os_version: "26.0", app_version: "0.1.0" },
    sensors: { tilt_deg: 3, rotation_rate: 0.1, steady: true },
    field_notes: { water_state: "still", debris_present: false },
    gate: { degraded: false, frame_checks: 2, consecutive_green: 2, last_hint: "Hold still.", ...(opts.gate ?? {}) },
  };
  const r = await createSubmission(
    req("POST", "/api/submissions", { token, body, headers: opts.variant ? { "x-mock-variant": opts.variant } : {} }),
    noCtx,
  );
  expect(r.status).toBe(202);
  const { submission_id } = (await r.json()) as { submission_id: string };
  await drainBackground();
  const g = await getSubmissionRoute(req("GET", `/api/submissions/${submission_id}`, { token }), idCtx(submission_id));
  return SubmissionWithMediaSchema.parse(await g.json());
}

const exportCsv = async () =>
  (await exportGet(req("GET", `/api/bounties/${DEMO.bountyId}/export?format=csv`, { token: researcher }), idCtx(DEMO.bountyId))).text();

describe("MOCK_GROK guard", () => {
  afterEach(() => {
    vi.stubEnv("LOCAL_BACKEND", "1");
    vi.stubEnv("ALLOW_MOCK_ON_REAL_DB", "");
    setDbForTests(env.db);
  });

  it("refuses MOCK_GROK=1 on a non-local database, loudly, before connecting", async () => {
    vi.stubEnv("LOCAL_BACKEND", "0");
    expect(() => assertMockGrokAllowed()).toThrow(MockOnRealDbError);
    expect(() => assertMockGrokAllowed()).toThrow(/MOCK_GROK=1 against a non-local database/);
    expect(() => openPostgres("postgres://u:p@db.example.com:5432/postgres")).toThrow(MockOnRealDbError);
    setDbForTests(null);
    await expect(getDb()).rejects.toThrow(MockOnRealDbError);
  });

  it("allows local PGlite, an explicit ALLOW_MOCK_ON_REAL_DB=1, or MOCK_GROK off", () => {
    vi.stubEnv("LOCAL_BACKEND", "1");
    expect(() => assertMockGrokAllowed()).not.toThrow();
    vi.stubEnv("LOCAL_BACKEND", "0");
    vi.stubEnv("ALLOW_MOCK_ON_REAL_DB", "1");
    expect(() => assertMockGrokAllowed()).not.toThrow();
    vi.stubEnv("ALLOW_MOCK_ON_REAL_DB", "");
    vi.stubEnv("MOCK_GROK", "0");
    expect(() => assertMockGrokAllowed()).not.toThrow();
    vi.stubEnv("MOCK_GROK", "1");
  });
});

describe("server-side capture gate", () => {
  it("counts consecutive all-green checks; any red, flagged or failed check resets the streak", async () => {
    const c = await contributor();
    const s = await openSession(c.token);
    expect((await check(c.token, s.session_id)).body).toMatchObject({ green_streak: 1, gate_passed: false });
    expect((await check(c.token, s.session_id, "missing_element")).body).toMatchObject({ all_green: false, green_streak: 0, gate_passed: false });
    expect((await check(c.token, s.session_id)).body).toMatchObject({ green_streak: 1, gate_passed: false });
    expect((await check(c.token, s.session_id)).body).toMatchObject({ green_streak: 2, gate_passed: true });
    const failed = await check(c.token, s.session_id, "error");
    expect(failed.status).toBe(502); // the phone retries on 5xx; the status code is part of its contract
    const after = await env.db.query<{ green_streak: number; gate_passed_at: unknown }>(
      "select green_streak, gate_passed_at from public.capture_sessions where id = $1",
      [s.session_id],
    );
    expect(after[0]!.green_streak).toBe(0);
    expect(after[0]!.gate_passed_at).not.toBeNull(); // the recorded pass sticks for the submission
  });

  it("mock results do not count on a non-local backend", () => {
    // (Route-level check is impossible here: dev auth only exists on the local backend.)
    expect(frameChecksCountTowardGate()).toBe(true); // local + mock
    vi.stubEnv("LOCAL_BACKEND", "0");
    try {
      expect(frameChecksCountTowardGate()).toBe(false); // real DB + mock (ALLOW_MOCK_ON_REAL_DB runs)
      vi.stubEnv("MOCK_GROK", "0");
      expect(frameChecksCountTowardGate()).toBe(true); // real model
    } finally {
      vi.stubEnv("LOCAL_BACKEND", "1");
      vi.stubEnv("MOCK_GROK", "1");
    }
  });

  it("recordFrameCheck: pass sets gate_passed_at once and it sticks; the reported state follows the streak", async () => {
    const c = await contributor();
    const s = await openSession(c.token);
    expect(await recordFrameCheck(env.db, s.session_id, true, 2)).toMatchObject({ green_streak: 1, gate_passed: false, gate_passed_at: null });
    const passed = await recordFrameCheck(env.db, s.session_id, true, 2);
    expect(passed).toMatchObject({ green_streak: 2, gate_passed: true });
    expect(passed.gate_passed_at).not.toBeNull();
    const reset = await recordFrameCheck(env.db, s.session_id, false, 2);
    expect(reset).toMatchObject({ green_streak: 0, gate_passed: false, gate_passed_at: passed.gate_passed_at });
    await recordFrameCheck(env.db, s.session_id, true, 2);
    expect((await recordFrameCheck(env.db, s.session_id, true, 2)).gate_passed_at).toBe(passed.gate_passed_at);
  });

  it("a session that never passed → needs_review (GATE_NOT_PASSED), nothing paid until a human approves", async () => {
    const c = await contributor();
    const s = await openSession(c.token);
    // The phone even claims a perfect gate; the server's record is what counts.
    const sub = await submit(c.token, s, { gate: { degraded: false, frame_checks: 5, consecutive_green: 2 } });
    expect(sub.status).toBe("needs_review");
    expect(sub.reason_codes).toContain("GATE_NOT_PASSED");
    expect(sub.payout_cents).toBe(0);
    expect(sub.checks.find((x) => x.stage === "session_integrity")?.subchecks?.find((x) => x.id === "gate")?.status).toBe("warn");
    const w = WalletResponseSchema.parse(await (await walletGet(req("GET", "/api/me/wallet", { token: c.token }), noCtx)).json());
    expect(w.balance_cents).toBe(0);

    const res = await review(req("POST", `/api/submissions/${sub.id}/review`, { token: researcher, body: { decision: "approve" } }), idCtx(sub.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { payout_cents: number }).payout_cents).toBeGreaterThan(0);
  });

  it("the phone's degraded claim alone never unlocks payment, even after a server pass", async () => {
    const c = await contributor();
    const s = await openSession(c.token);
    await passGate(c.token, s.session_id);
    const sub = await submit(c.token, s, { gate: { degraded: true, frame_checks: 2, consecutive_green: 0 } });
    expect(sub.status).toBe("needs_review");
    expect(sub.reason_codes).toContain("GATE_DEGRADED");
    expect(sub.reason_codes).not.toContain("GATE_NOT_PASSED");
    expect(sub.payout_cents).toBe(0);
  });

  it("a passed gate + genuine capture is still accepted and paid", async () => {
    const c = await contributor();
    const s = await openSession(c.token);
    await passGate(c.token, s.session_id);
    const sub = await submit(c.token, s);
    expect(sub.status).toBe("accepted");
    expect(sub.payout_cents).toBeGreaterThan(0);
    expect(sub.verifier).toBe("mock"); // MOCK_GROK decided: recorded, and never exported
  });
});

describe("relevance stage (OFF_TOPIC)", () => {
  it("off-topic → rejected (retryable), contributor told what was expected, model never called", async () => {
    const verify = vi.fn(async () => mockVerification(streetFloodDepth));
    setPipelineDepsOverrideForTests({ verify });
    const c = await contributor();
    const s = await openSession(c.token);
    await passGate(c.token, s.session_id);
    const sub = await submit(c.token, s, { variant: "off_topic" });
    expect(sub.status).toBe("rejected");
    expect(sub.retryable).toBe(true);
    expect(sub.reason_codes).toContain("OFF_TOPIC");
    const rel = sub.checks.find((x) => x.stage === "relevance")!;
    expect(rel.status).toBe("fail");
    expect(rel.evidence.join(" ")).toMatch(/Expected: a street flood depth scene/);
    expect(rel.evidence.join(" ")).toMatch(/vitamin water/);
    expect(sub.checks.filter((x) => x.status === "skipped").map((x) => x.stage)).toEqual(["challenge", "protocol", "authenticity"]);
    expect(verify).not.toHaveBeenCalled();
  });

  it("a relevance error is a stage error → needs_review, never a pass", async () => {
    setPipelineDepsOverrideForTests({ relevance: async () => { throw new Error("fast model down"); } });
    const c = await contributor();
    const s = await openSession(c.token);
    await passGate(c.token, s.session_id);
    const sub = await submit(c.token, s);
    expect(sub.checks.find((x) => x.stage === "relevance")?.status).toBe("error");
    expect(sub.status).toBe("needs_review");
    expect(sub.reason_codes).toContain("STAGE_ERROR");
  });
});

describe("extraction sanity in the pipeline", () => {
  const cells = cellsForCircle(DEMO.lat, DEMO.lng, DEMO.radiusM);
  const NOON = "2026-09-26T16:00:00.000Z";
  async function run(extraction: Record<string, unknown>, over: Partial<PipelineDeps> = {}) {
    const frames = await Promise.all([0, 1, 2].map(async (i) => ({ path: `observations/u/s/${i}.jpg`, bytes: await randomJpeg(320, 240) })));
    const input: PipelineInput = {
      source: "eval", submissionId: null, userId: null, frames, lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5,
      captured_at: NOON, received_at: NOON, nonce: null, device: { os: "ios" }, sensors: {}, gate: {}, field_notes: {},
      h3_cell: cellForPoint(DEMO.lat, DEMO.lng),
      bounty: { id: DEMO.bountyId, cells, area: circlePolygon(DEMO.lat, DEMO.lng, DEMO.radiusM), starts_at: "2026-09-25T00:00:00Z", ends_at: "2026-10-05T00:00:00Z" },
      protocol: streetFloodDepth, session: null, challenge: streetFloodDepth.capture.challenges[0]!, trustScore: 0.5,
    };
    const base = mockVerification(streetFloodDepth);
    return runPipeline(
      input,
      isolatedDeps({
        demoMode: false, offline: false, precipitationMm: async () => 22, alertsAt: async () => [],
        relevance: async () => mockRelevance(streetFloodDepth),
        verify: async () => ({ ...base, extraction: { ...base.extraction, ...extraction } }),
        ...over,
      }),
      memorySink(),
    );
  }

  it("depth over the reference height × 1.1 → needs_review (EXTRACTION_IMPLAUSIBLE)", async () => {
    const r = await run({ depth_cm: 80, reference_object_type: "curb", reference_object_assumed_height_cm: 15 });
    expect(r.decision.status).toBe("needs_review");
    expect(r.decision.reasonCodes).toContain("EXTRACTION_IMPLAUSIBLE");
    expect(r.checks.find((c) => c.stage === "protocol")?.subchecks?.find((s) => s.id === "extraction:max_relative:depth_cm")?.status).toBe("warn");
  });

  it("no depth → rejected (EXTRACTION_MISSING, retryable)", async () => {
    const r = await run({ depth_cm: null });
    expect(r.decision.status).toBe("rejected");
    expect(r.decision.retryable).toBe(true);
    expect(r.decision.reasonCodes).toContain("EXTRACTION_MISSING");
  });

  it("depth_confidence < 0.4 → needs_review", async () => {
    const r = await run({ depth_confidence: 0.2 });
    expect(r.decision.status).toBe("needs_review");
    expect(r.decision.reasonCodes).toContain("EXTRACTION_LOW_CONFIDENCE");
  });

  it("the default mock reading passes the rules (accepted)", async () => {
    expect((await run({})).decision.status).toBe("accepted");
  });
});

describe("provenance, exports and publishing", () => {
  let n = 0;
  async function row(verifier: "model" | "mock" | "human" | "none", confidence: number, status: "accepted" | "rejected" = "accepted") {
    const user = randomUUID();
    await ensureDevUser(env.db, user);
    const at = new Date(Date.now() - (60 + n++) * 60_000).toISOString();
    const id = await insertSubmission(env.db, {
      session_id: null, bounty_id: DEMO.bountyId, user_id: user, media: [], lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5,
      h3_cell: cellForPoint(DEMO.lat, DEMO.lng), captured_at: at, device: { model: "Pixel", os: "android", os_version: null, app_version: null },
      sensors: {}, gate: {}, field_notes: {}, checks: pendingChecks(),
    });
    await finalizeSubmission(env.db, id, {
      status, checks: pendingChecks(), reason_codes: [], confidence, protocol_score: 0.9, authenticity_score: 0.9,
      extracted: { depth_cm: 10, depth_confidence: 0.8, reference_object_type: "curb", reference_object_assumed_height_cm: 15, surface_type: "road", water_state: "still" },
      phashes: [], payout_cents: 0, retryable: false, verifier,
    });
    return id;
  }

  it("researcher export excludes mock/none; public data needs human, or model ≥ 0.75", async () => {
    const ids = {
      model: await row("model", 0.8),
      modelLow: await row("model", 0.7),
      human: await row("human", 0.6),
      mock: await row("mock", 0.99),
      none: await row("none", 0.99),
      rejected: await row("human", 0.99, "rejected"),
    };
    const protocol = (await getProtocolBySlug(env.db, "street-flood-depth"))!;
    const exported = new Set((await exportRows(env.db, DEMO.bountyId, protocol.definition)).map((r) => r.observation_id));
    expect(exported.has(ids.model) && exported.has(ids.modelLow) && exported.has(ids.human)).toBe(true);
    expect(exported.has(ids.mock) || exported.has(ids.none) || exported.has(ids.rejected)).toBe(false);
    const csv = await exportCsv();
    expect(csv).not.toContain(ids.mock);
    expect(csv).not.toContain(ids.none);

    const pub = await publicRows(env.db, protocol);
    const tiers = pub.map((r) => r.quality_tier);
    expect(tiers.every((t) => t === "human_verified" || t === "model_high")).toBe(true);
    const summary = await datasetSummary(env.db, protocol, "http://localhost:3000");
    expect(summary.rows).toBe(pub.length);
    expect(summary.tiers.human_verified + summary.tiers.model_high).toBe(pub.length);
    expect(summary.tiers.human_verified).toBeGreaterThanOrEqual(1);
    expect(summary.includes_demo_rows).toBe(false);
    // exactly the model ≥ 0.75 and human rows made it (pseudonymised ids, so compare counts by tier)
    const before = summary.tiers;
    await row("model", 0.7);
    await row("mock", 0.99);
    await row("none", 0.99);
    expect((await datasetSummary(env.db, protocol, "http://localhost:3000")).tiers).toEqual(before);
    await row("model", 0.9);
    expect((await datasetSummary(env.db, protocol, "http://localhost:3000")).tiers.model_high).toBe(before.model_high + 1);
  });

  it("a human approval of a mock-decided row keeps it unpublishable; of a model row, marks it human", async () => {
    const c = await contributor();
    const s1 = await openSession(c.token);
    const mockSub = await submit(c.token, s1, { variant: "error" }); // mock mode → verifier mock, needs_review
    expect(mockSub.status).toBe("needs_review");
    await review(req("POST", `/api/submissions/${mockSub.id}/review`, { token: researcher, body: { decision: "approve" } }), idCtx(mockSub.id));
    expect((await getSubmission(env.db, mockSub.id))!.verifier).toBe("mock");

    setPipelineDepsOverrideForTests({ verifier: "model" });
    const s2 = await openSession(c.token);
    const modelSub = await submit(c.token, s2, { variant: "error" });
    await review(req("POST", `/api/submissions/${modelSub.id}/review`, { token: researcher, body: { decision: "approve" } }), idCtx(modelSub.id));
    const after = (await getSubmission(env.db, modelSub.id))!;
    expect(after.status).toBe("accepted");
    expect(after.verifier).toBe("human");
  });

  it("an empty dataset renders: 0 rows, zero tiers, no bbox", async () => {
    const protocol = (await getProtocolBySlug(env.db, "street-flood-depth"))!;
    const empty = { ...protocol, slug: "no-rows-yet" };
    const summary = await datasetSummary(env.db, empty, "http://localhost:3000");
    expect(summary).toMatchObject({ rows: 0, contributors: 0, bbox: null, time_range: null, tiers: { human_verified: 0, model_high: 0 } });
    const list = PublicDatasetListResponseSchema.parse(await (await listDatasets(req("GET", "/api/public/datasets"), noCtx)).json());
    expect(list.datasets.every((d) => d.tiers.human_verified + d.tiers.model_high === d.rows)).toBe(true);
  });
});

describe("incident replay: vitamin-water bottle on a street-flood bounty", () => {
  it("0 server-recorded green checks + phone claims degraded + reasoning model times out + relevance says off-topic → rejected OFF_TOPIC, $0, in no export", async () => {
    const verify = vi.fn(async (): Promise<never> => {
      throw new Error("verification failed: Request timed out.");
    });
    setPipelineDepsOverrideForTests({ verify, verifier: "model" }); // as in production: the real model decides
    const c = await contributor();
    const s = await openSession(c.token); // no frame check ever succeeds
    const failed = await check(c.token, s.session_id, "error");
    expect(failed.status).toBe(502);

    const sub = await submit(c.token, s, { variant: "off_topic", gate: { degraded: true, frame_checks: 0, consecutive_green: 0, last_hint: null } });

    expect(sub.status).toBe("rejected");
    expect(sub.reason_codes).toEqual(expect.arrayContaining(["OFF_TOPIC", "GATE_NOT_PASSED", "GATE_DEGRADED"]));
    expect(sub.payout_cents).toBe(0);
    expect(sub.retryable).toBe(true);
    const w = WalletResponseSchema.parse(await (await walletGet(req("GET", "/api/me/wallet", { token: c.token }), noCtx)).json());
    expect(w.balance_cents).toBe(0);
    const ledger = await env.db.query("select id from public.ledger_entries where submission_id = $1", [sub.id]);
    expect(ledger).toHaveLength(0);

    expect(await exportCsv()).not.toContain(sub.id);
    const protocol = (await getProtocolBySlug(env.db, "street-flood-depth"))!;
    const exported = await exportRows(env.db, DEMO.bountyId, protocol.definition);
    expect(exported.some((r) => r.observation_id === sub.id)).toBe(false);
    // Public rows are pseudonymised; the row can't be there because it is not accepted.
    const inView = await env.db.query("select 1 from public.observations_export where observation_id = $1", [sub.id]);
    expect(inView).toHaveLength(0);

    // Same capture if the slow model's timeout were the only signal (no relevance stage): the old
    // behaviour, needs_review by luck. Guard that the relevance verdict is what decides now.
    const rel = sub.checks.find((x) => x.stage === "relevance")!;
    expect(rel.status).toBe("fail");
  });
});
