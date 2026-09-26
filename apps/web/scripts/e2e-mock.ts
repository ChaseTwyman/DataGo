/**
 * End-to-end API script (M1 acceptance). Starts nothing: point it at a running server.
 *   LOCAL_BACKEND=1 MOCK_GROK=1 DEMO_MODE=1 pnpm --filter @groundtruth/web dev
 *   BASE_URL=http://localhost:3000 pnpm --filter @groundtruth/web e2e:mock
 * Contributor: dev session → nearby → bounty detail → session → PUT 3 JPEGs → frame-check (default +
 * screen_recapture) → submit → poll to terminal → accepted + wallet credited.
 * Researcher: submissions list, coverage, CSV + GeoJSON export, red team (ai_generated + recycled).
 * Exits non-zero on the first failed expectation.
 */
import { existsSync } from "node:fs";
import sharp from "sharp";
import {
  CoverageResponseSchema,
  CreateSessionResponseSchema,
  DEMO,
  DevSessionResponseSchema,
  FrameCheckResponseSchema,
  HealthResponseSchema,
  NearbyResponseSchema,
  RedteamRunResponseSchema,
  SubmissionListResponseSchema,
  SubmissionWithMediaSchema,
  WalletResponseSchema,
  BountyDetailSchema,
} from "@groundtruth/shared";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const results: { step: string; ok: boolean; detail: string; ms: number }[] = [];

class StepError extends Error {}

async function step<T>(name: string, fn: () => Promise<[T, string]>): Promise<T> {
  const t0 = Date.now();
  try {
    const [v, detail] = await fn();
    results.push({ step: name, ok: true, detail, ms: Date.now() - t0 });
    console.log(`  ✓ ${name.padEnd(34)} ${detail}`);
    return v;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ step: name, ok: false, detail: msg, ms: Date.now() - t0 });
    console.log(`  ✗ ${name.padEnd(34)} ${msg}`);
    throw new StepError(msg);
  }
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function api(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return { res, json, text };
}

/** A unique blocky JPEG per call (different dHash each run, so reruns never trip DUPLICATE). */
async function frame(seed: number, w = 640, h = 480): Promise<Buffer> {
  let a = (seed * 2654435761) >>> 0;
  const rand = () => ((a = (Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  const raw = Buffer.alloc(w * h * 3);
  const block = 40;
  const cols = Math.ceil(w / block);
  const palette = Array.from({ length: cols * Math.ceil(h / block) }, () => [rand() * 255, rand() * 255, rand() * 255]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = palette[Math.floor(y / block) * cols + Math.floor(x / block)]!;
      raw.set([c[0]!, c[1]!, c[2]!], (y * w + x) * 3);
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}

interface Tok {
  user_id: string;
  access_token: string;
  role: string;
}

async function devToken(role: "contributor" | "researcher"): Promise<Tok> {
  return DevSessionResponseSchema.parse((await api("POST", "/api/dev/session", { body: { role } })).json);
}

/** Supabase backend: anonymous sign-in (contributor) or the seeded researcher's password login. */
async function supabaseToken(role: "contributor" | "researcher"): Promise<Tok> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(url && anon, "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY needed for the Supabase backend");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } =
    role === "contributor"
      ? await sb.auth.signInAnonymously()
      : await sb.auth.signInWithPassword({ email: DEMO.researcherEmail, password: DEMO.researcherPassword });
  expect(!error && data.session, `supabase ${role} sign-in failed: ${error?.message ?? "no session"}`);
  return { user_id: data.session.user.id, access_token: data.session.access_token, role };
}

async function main(): Promise<void> {
  console.log(`GroundTruth e2e (mock) against ${BASE}\n`);
  const seed = Date.now() % 1_000_000;

  const health = await step("health", async () => {
    const h = HealthResponseSchema.parse((await api("GET", "/api/health")).json);
    expect(h.ok, "db not ok");
    return [h, `backend=${h.backend} mock_grok=${h.mock_grok} demo=${h.demo_mode} realtime=${h.realtime}`];
  });
  if (!health.mock_grok) console.log("  ! MOCK_GROK is off: real Grok calls will be made (random test frames will not be accepted)");

  const c = await step("contributor session", async () => {
    const s = health.backend === "local" ? await devToken("contributor") : await supabaseToken("contributor");
    return [s, `${health.backend} user ${s.user_id.slice(0, 8)}`];
  });

  const bounty = await step("nearby", async () => {
    const nb = NearbyResponseSchema.parse((await api("GET", `/api/bounties/nearby?lat=${DEMO.lat}&lng=${DEMO.lng}&radius_km=25`, { token: c.access_token })).json);
    const b = nb.bounties.find((x) => x.id === DEMO.bountyId) ?? nb.bounties[0];
    expect(b, "no bounties nearby");
    return [b, `${nb.bounties.length} bounty(ies); "${b.title}" $${(b.price_cents / 100).toFixed(2)} ×${b.surge} match=${b.match_score}`];
  });

  const detail = await step("bounty detail", async () => {
    const d = BountyDetailSchema.parse((await api("GET", `/api/bounties/${bounty.id}`, { token: c.access_token })).json);
    return [d, `${d.coverage.length} cells, protocol ${d.protocol.slug}, example=${d.example_image_url ? "yes" : "no"}`];
  });

  const session = await step("create capture session", async () => {
    const s = CreateSessionResponseSchema.parse(
      (await api("POST", "/api/capture/sessions", { token: c.access_token, body: { bounty_id: bounty.id, lat: detail.center_lat, lng: detail.center_lng, accuracy_m: 5 } })).json,
    );
    return [s, `quote $${(s.price_quote_cents / 100).toFixed(2)}, challenge "${s.challenge.id}", ${s.uploads.length} upload URLs`];
  });

  await step("PUT 3 JPEG frames", async () => {
    const sizes: number[] = [];
    for (const [i, u] of session.uploads.entries()) {
      const bytes = await frame(seed * 10 + i);
      const res = await fetch(u.signed_url, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: new Uint8Array(bytes) });
      expect(res.ok, `upload ${i} → ${res.status}`);
      sizes.push(bytes.length);
    }
    return [null, sizes.map((s) => `${Math.round(s / 1024)}KB`).join(", ")];
  });

  await step("frame-check (default)", async () => {
    const img = (await frame(seed + 7, 640, 360)).toString("base64");
    const r = FrameCheckResponseSchema.parse((await api("POST", "/api/capture/frame-check", { token: c.access_token, body: { session_id: session.session_id, image_base64: img } })).json);
    expect(r.all_green, "default frame check should be all green");
    return [r, `all_green=${r.all_green} hint="${r.result.hint}" used=${r.checks_used}/${r.checks_used + r.checks_remaining}`];
  });

  await step("frame-check (screen_recapture)", async () => {
    const img = (await frame(seed + 8, 640, 360)).toString("base64");
    const r = FrameCheckResponseSchema.parse(
      (await api("POST", "/api/capture/frame-check", { token: c.access_token, body: { session_id: session.session_id, image_base64: img }, headers: { "x-mock-variant": "screen_recapture" } })).json,
    );
    expect(!r.all_green && r.result.suspected_screen_or_print.value, "screen should be flagged");
    return [r, `flagged screen (confidence ${r.result.suspected_screen_or_print.confidence})`];
  });

  const submissionId = await step("submit", async () => {
    const at = new Date().toISOString();
    const r = (
      await api("POST", "/api/submissions", {
        token: c.access_token,
        body: {
          session_id: session.session_id,
          nonce: session.nonce,
          media: session.uploads.map((u) => ({ path: u.path, width: 640, height: 480, captured_at: at })),
          lat: detail.center_lat,
          lng: detail.center_lng,
          accuracy_m: 5,
          captured_at: at,
          device: { model: "e2e-script", os: "ios", os_version: "26.0", app_version: "0.1.0" },
          sensors: { tilt_deg: 3, rotation_rate: 0.05, steady: true },
          field_notes: { water_state: "still", debris_present: false },
          gate: { degraded: false, frame_checks: 2, consecutive_green: 2, last_hint: "Hold still." },
        },
      })
    ).json as { submission_id: string; status: string };
    return [r.submission_id, `${r.submission_id.slice(0, 8)} status=${r.status}`];
  });

  const final = await step("poll until terminal", async () => {
    const deadline = Date.now() + 60_000;
    let polls = 0;
    for (;;) {
      polls++;
      const s = SubmissionWithMediaSchema.parse((await api("GET", `/api/submissions/${submissionId}`, { token: c.access_token })).json);
      if (["accepted", "rejected", "needs_review"].includes(s.status)) {
        const stages = s.checks.map((x) => `${x.stage}:${x.status}`).join(" ");
        return [s, `${s.status} after ${polls} poll(s) conf=${s.confidence} codes=[${s.reason_codes.join(",")}]\n      ${stages}`];
      }
      expect(Date.now() < deadline, `still ${s.status} after 60 s`);
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  await step("expect accepted", async () => {
    expect(final.status === "accepted", `expected accepted, got ${final.status}`);
    return [null, `payout $${((final.payout_cents ?? 0) / 100).toFixed(2)}`];
  });

  await step("wallet credited", async () => {
    const w = WalletResponseSchema.parse((await api("GET", "/api/me/wallet", { token: c.access_token })).json);
    expect(w.balance_cents === final.payout_cents && w.balance_cents > 0, `balance ${w.balance_cents} != payout ${final.payout_cents}`);
    return [w, `balance $${(w.balance_cents / 100).toFixed(2)}, trust ${w.trust_score}`];
  });

  const r = await step("researcher session", async () => {
    const s = health.backend === "local" ? await devToken("researcher") : await supabaseToken("researcher");
    return [s, `${health.backend} ${s.role}`];
  });

  await step("researcher: submissions list", async () => {
    const l = SubmissionListResponseSchema.parse((await api("GET", `/api/submissions?bounty_id=${bounty.id}&limit=20`, { token: r.access_token })).json);
    expect(l.submissions.some((s) => s.id === submissionId), "new submission missing from list");
    return [l, `${l.submissions.length} submission(s), includes ours`];
  });

  await step("researcher: coverage", async () => {
    const cov = CoverageResponseSchema.parse((await api("GET", `/api/bounties/${bounty.id}/coverage`, { token: r.access_token })).json);
    const filled = cov.cells.filter((x) => x.accepted > 0).length;
    const paused = cov.cells.filter((x) => x.paused).length;
    return [cov, `${cov.cells.length} cells, ${filled} with accepted obs, ${paused} paused, max ×${Math.max(...cov.cells.map((x) => x.surge))}`];
  });

  await step("researcher: export CSV", async () => {
    const { text, res } = await api("GET", `/api/bounties/${bounty.id}/export?format=csv`, { token: r.access_token });
    const lines = text.trim().split(/\r?\n/);
    expect(res.headers.get("content-type")?.includes("text/csv"), "not csv");
    expect(lines[0]?.includes("depth_cm"), "no depth_cm column");
    expect(text.includes(submissionId), "our observation missing from CSV");
    return [null, `${lines.length - 1} row(s), ${lines[0]!.split(",").length} columns`];
  });

  await step("researcher: export GeoJSON", async () => {
    const fc = (await api("GET", `/api/bounties/${bounty.id}/export?format=geojson`, { token: r.access_token })).json as { type: string; features: unknown[] };
    expect(fc.type === "FeatureCollection" && fc.features.length > 0, "empty GeoJSON");
    return [null, `${fc.features.length} feature(s)`];
  });

  for (const attack of ["ai_generated", "recycled"] as const) {
    await step(`red team: ${attack}`, async () => {
      const rr = RedteamRunResponseSchema.parse((await api("POST", "/api/redteam/run", { token: r.access_token, body: { bounty_id: bounty.id, attack_type: attack } })).json);
      expect(rr.caught, `${attack} was NOT caught (status ${rr.status})`);
      return [rr, `caught → ${rr.status} [${rr.reason_codes.join(",")}]`];
    });
  }
}

main()
  .then(() => {
    const ms = results.reduce((a, r) => a + r.ms, 0);
    console.log(`\nPASS ${results.length}/${results.length} steps in ${(ms / 1000).toFixed(1)} s`);
  })
  .catch((err) => {
    const failed = results.filter((r) => !r.ok).length;
    if (!(err instanceof StepError)) console.error(err);
    console.log(`\nFAIL (${results.length - failed} passed, ${failed} failed)`);
    process.exit(1);
  });
