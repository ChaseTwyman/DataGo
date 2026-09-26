/**
 * M1 acceptance as a test: the full contributor loop through the real route handlers on PGlite
 * (real migrations), local storage, dev auth, MOCK_GROK, DEMO_MODE. No network: context fetch stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateSessionResponseSchema,
  DEMO,
  FrameCheckResponseSchema,
  NearbyResponseSchema,
  SubmissionWithMediaSchema,
  WalletResponseSchema,
  type CreateSessionResponse,
} from "@groundtruth/shared";
import { captureBackground, drainBackground } from "@/lib/background";
import { setContextFetch } from "@/lib/context/fetcher";
import { clearHazardCache } from "@/lib/hazards";
import { POST as devSession } from "@/app/api/dev/session/route";
import { PUT as devUpload } from "@/app/api/dev/upload/route";
import { GET as devMedia } from "@/app/api/dev/media/route";
import { GET as nearby } from "@/app/api/bounties/nearby/route";
import { GET as bountyGet } from "@/app/api/bounties/[id]/route";
import { POST as createSession } from "@/app/api/capture/sessions/route";
import { POST as frameCheck } from "@/app/api/capture/frame-check/route";
import { POST as createSubmission } from "@/app/api/submissions/route";
import { GET as getSubmission } from "@/app/api/submissions/[id]/route";
import { GET as walletGet } from "@/app/api/me/wallet/route";
import { GET as health } from "@/app/api/health/route";
import { idCtx, passGate, randomJpeg, req, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
const noCtx = undefined as unknown;

beforeAll(async () => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  vi.stubEnv("DEMO_MODE", "1");
  env = await setupTestEnv();
  captureBackground();
  setContextFetch(async () => Response.json({ features: [] }));
}, 60_000);
afterAll(async () => {
  setContextFetch(null);
  vi.unstubAllEnvs();
  await env.close();
});
beforeEach(() => clearHazardCache());

async function contributor(): Promise<string> {
  const r = await devSession(req("POST", "/api/dev/session", { body: { role: "contributor" } }), noCtx);
  expect(r.status).toBe(200);
  return ((await r.json()) as { access_token: string }).access_token;
}

/** Opens a session; by default also passes the server-side capture gate (2 green frame checks). */
async function openSession(token: string, gate = true): Promise<CreateSessionResponse> {
  const r = await createSession(
    req("POST", "/api/capture/sessions", { token, body: { bounty_id: DEMO.bountyId, lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5 } }),
    noCtx,
  );
  expect(r.status).toBe(201);
  const s = CreateSessionResponseSchema.parse(await r.json());
  if (gate) await passGate(token, s.session_id);
  return s;
}

async function uploadFrames(s: CreateSessionResponse, frames?: Buffer[]): Promise<void> {
  for (const [i, u] of s.uploads.entries()) {
    const url = new URL(u.signed_url);
    const bytes = frames?.[i] ?? (await randomJpeg());
    const r = await devUpload(req("PUT", url.pathname + url.search, { raw: bytes }), noCtx);
    expect(r.status).toBe(200);
  }
}

function submissionBody(s: CreateSessionResponse, over: Record<string, unknown> = {}) {
  const at = new Date().toISOString();
  return {
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
    gate: { degraded: false, frame_checks: 4, consecutive_green: 2, last_hint: "Hold still." },
    ...over,
  };
}

async function submitAndSettle(token: string, s: CreateSessionResponse, headers: Record<string, string> = {}, over: Record<string, unknown> = {}) {
  const r = await createSubmission(req("POST", "/api/submissions", { token, body: submissionBody(s, over), headers }), noCtx);
  expect(r.status).toBe(202);
  const { submission_id } = (await r.json()) as { submission_id: string };
  await drainBackground();
  const g = await getSubmission(req("GET", `/api/submissions/${submission_id}`, { token }), idCtx(submission_id));
  expect(g.status).toBe(200);
  return SubmissionWithMediaSchema.parse(await g.json());
}

describe("contributor loop (mock mode, local backend)", () => {
  it("health reports local backend without realtime", async () => {
    const r = await health(req("GET", "/api/health"), noCtx);
    expect(await r.json()).toEqual({ ok: true, backend: "local", mock_grok: true, demo_mode: true, realtime: false });
  });

  it("nearby → detail → session → upload → frame-check → submit → accepted + wallet credited", async () => {
    const token = await contributor();
    const nb = NearbyResponseSchema.parse(await (await nearby(req("GET", `/api/bounties/nearby?lat=${DEMO.lat}&lng=${DEMO.lng}`, { token }), noCtx)).json());
    const b = nb.bounties.find((x) => x.id === DEMO.bountyId);
    expect(b).toBeDefined();
    expect(b!.price_cents).toBeGreaterThanOrEqual(DEMO.baseCents);
    expect(b!.surge).toBeGreaterThan(1);
    expect(b!.match_score).not.toBeNull();

    const detail = await bountyGet(req("GET", `/api/bounties/${DEMO.bountyId}`, { token }), idCtx(DEMO.bountyId));
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { coverage: unknown[] }).coverage.length).toBeGreaterThan(5);

    const s = await openSession(token, false);
    expect(s.uploads).toHaveLength(3);
    expect(s.uploads[0]!.path).toMatch(/^observations\/[0-9a-f-]+\/[0-9a-f-]+\/0\.jpg$/);
    await uploadFrames(s);

    const img = (await randomJpeg(320, 240)).toString("base64");
    const fc = await frameCheck(req("POST", "/api/capture/frame-check", { token, body: { session_id: s.session_id, image_base64: img } }), noCtx);
    const fcBody = FrameCheckResponseSchema.parse(await fc.json());
    expect(fcBody.all_green).toBe(true);
    expect(fcBody.checks_used).toBe(1);
    expect(fcBody).toMatchObject({ green_streak: 1, gate_passed: false });
    const fcPass = FrameCheckResponseSchema.parse(
      await (await frameCheck(req("POST", "/api/capture/frame-check", { token, body: { session_id: s.session_id, image_base64: img } }), noCtx)).json(),
    );
    expect(fcPass).toMatchObject({ all_green: true, green_streak: 2, gate_passed: true });
    const fc2 = await frameCheck(
      req("POST", "/api/capture/frame-check", { token, body: { session_id: s.session_id, image_base64: img }, headers: { "x-mock-variant": "screen_recapture" } }),
      noCtx,
    );
    const fc2Body = FrameCheckResponseSchema.parse(await fc2.json());
    expect(fc2Body.all_green).toBe(false);
    expect(fc2Body.result.suspected_screen_or_print.value).toBe(true);
    // A flagged check resets the streak and reports the gate closed (the phone locks again); the
    // server-side pass already recorded for the session sticks, so the submission is judged on it.
    expect(fc2Body).toMatchObject({ green_streak: 0, gate_passed: false });

    const sub = await submitAndSettle(token, s);
    expect(sub.status).toBe("accepted");
    expect(sub.checks.map((c) => c.status)).not.toContain("pending");
    expect(sub.checks.find((c) => c.stage === "context")?.subchecks?.find((x) => x.id === "precipitation")?.status).toBe("waived");
    expect(sub.reason_codes).toContain("DEMO_WAIVER");
    expect(sub.payout_cents).toBeGreaterThan(0);
    expect(sub.media_urls[0]).toContain("/api/dev/media?");

    const mediaUrl = new URL(sub.media_urls[0]!);
    const m = await devMedia(req("GET", mediaUrl.pathname + mediaUrl.search), noCtx);
    expect(m.status).toBe(200);
    expect(m.headers.get("content-type")).toBe("image/jpeg");

    const w = WalletResponseSchema.parse(await (await walletGet(req("GET", "/api/me/wallet", { token }), noCtx)).json());
    expect(w.balance_cents).toBe(sub.payout_cents);
    expect(w.trust_score).toBeCloseTo(0.52);
  });

  it("double submit of one session is refused", async () => {
    const token = await contributor();
    const s = await openSession(token);
    await uploadFrames(s);
    await submitAndSettle(token, s);
    const again = await createSubmission(req("POST", "/api/submissions", { token, body: submissionBody(s) }), noCtx);
    expect(again.status).toBe(409);
  });

  it("resubmitting the same frames in a new session is caught as DUPLICATE", async () => {
    const token = await contributor();
    const frames = [await randomJpeg(), await randomJpeg(), await randomJpeg()];
    const s1 = await openSession(token);
    await uploadFrames(s1, frames);
    expect((await submitAndSettle(token, s1)).status).toBe("accepted");
    const token2 = await contributor();
    const s2 = await openSession(token2);
    await uploadFrames(s2, frames);
    const dup = await submitAndSettle(token2, s2);
    expect(dup.status).toBe("rejected");
    expect(dup.reason_codes).toContain("DUPLICATE");
    expect(dup.payout_cents).toBe(0);
  });

  it("wrong nonce → SESSION_INVALID, remaining stages skipped", async () => {
    const token = await contributor();
    const s = await openSession(token);
    await uploadFrames(s);
    const sub = await submitAndSettle(token, s, {}, { nonce: "not-the-real-nonce" });
    expect(sub.status).toBe("rejected");
    expect(sub.reason_codes).toContain("SESSION_INVALID");
    expect(sub.checks.slice(1).every((c) => c.status === "skipped")).toBe(true);
  });

  it("a Grok verification error routes to needs_review, never accepted", async () => {
    const token = await contributor();
    const s = await openSession(token);
    await uploadFrames(s);
    const sub = await submitAndSettle(token, s, { "x-mock-variant": "error" });
    expect(sub.status).toBe("needs_review");
    expect(sub.reason_codes).toContain("STAGE_ERROR");
    expect(sub.checks.filter((c) => c.status === "error").map((c) => c.stage)).toEqual(["challenge", "protocol", "authenticity"]);
  });

  it("missing element → retryable reject that reopens the session", async () => {
    const token = await contributor();
    const s = await openSession(token);
    await uploadFrames(s);
    const sub = await submitAndSettle(token, s, { "x-mock-variant": "missing_element" });
    expect(sub.status).toBe("rejected");
    expect(sub.retryable).toBe(true);
    expect(sub.reason_codes).toContain("MISSING_ELEMENT:waterline");
    await uploadFrames(s);
    const retry = await submitAndSettle(token, s);
    expect(retry.status).toBe("accepted");
  });

  it("synthetic media paths are refused at the door", async () => {
    const token = await contributor();
    const s = await openSession(token);
    const body = submissionBody(s);
    body.media = [{ path: "synthetic/redteam/fake.jpg", width: 640, height: 480, captured_at: new Date().toISOString() }];
    const r = await createSubmission(req("POST", "/api/submissions", { token, body }), noCtx);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("SYNTHETIC_MEDIA");
  });

  it("session outside the area is refused", async () => {
    const token = await contributor();
    const r = await createSession(
      req("POST", "/api/capture/sessions", { token, body: { bounty_id: DEMO.bountyId, lat: DEMO.lat + 0.2, lng: DEMO.lng, accuracy_m: 5 } }),
      noCtx,
    );
    expect(r.status).toBe(422);
  });
});
