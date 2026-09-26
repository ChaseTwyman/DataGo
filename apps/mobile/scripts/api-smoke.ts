/**
 * Drives the phone's own API client (src/api/http.ts + endpoints.ts, the exact code the app
 * ships) and the pure capture gate against a running web server — the device-free check that the
 * mobile side and the web routes agree on the shared contracts.
 *
 *   LOCAL_BACKEND=1 MOCK_GROK=1 DEMO_MODE=1 pnpm dev:web
 *   pnpm --filter @groundtruth/mobile smoke -- a.jpg b.jpg c.jpg   (API_BASE_URL defaults to :3000)
 *
 * Flow: health → dev session (reused id) → nearby → bounty → session → frame checks through the
 * gate reducer (default ×2 unlocks; screen_recapture flags) → PUT raw JPEGs to signed URLs →
 * submission → poll 1 s to a final status → result copy → wallet.
 */
import { readFileSync } from "node:fs";
import { DEMO, insideBountyArea, type FrameCheckResult, type MockVariant } from "@groundtruth/shared";
import { endpoints } from "../src/api/endpoints";
import { Http, type FetchLike } from "../src/api/http";
import { resultView, watchSubmission } from "../src/api/submissionWatch";
import { gateReducer, initialGate, lockReason, type DeviceChecks, type GateState } from "../src/capture/gateMachine";

const BASE = process.env.API_BASE_URL ?? "http://localhost:3000";
const files = process.argv.slice(2).filter((a) => a !== "--");
if (files.length === 0) {
  console.error("usage: api-smoke <jpeg> [jpeg…]");
  process.exit(2);
}

let token: string | null = null;
let variant: MockVariant = "default";
const http = new Http({ baseUrl: BASE, fetch: fetch as unknown as FetchLike, getToken: () => token, getMockVariant: () => variant });
const api = endpoints(http);

function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log(`API ${BASE}`);
  const health = await api.health();
  ok(health.ok, `health: backend=${health.backend} mock_grok=${health.mock_grok} realtime=${health.realtime}`);

  const s1 = await api.devSession();
  const s2 = await api.devSession(s1.user_id);
  ok(s2.user_id === s1.user_id, "dev session reuses the persisted user id");
  token = s2.access_token;

  const nearby = await api.nearby(DEMO.lat, DEMO.lng, 25);
  const summary = nearby.bounties.find((b) => b.id === DEMO.bountyId) ?? nearby.bounties[0];
  ok(summary, `nearby: ${nearby.bounties.length} bounties, ${summary?.title} ${summary?.price_cents}¢ ×${summary?.surge}`);

  const bounty = await api.bounty(summary.id);
  ok(bounty.coverage.length > 0, `bounty detail: ${bounty.cells.length} cells, protocol ${bounty.protocol.slug}`);
  const lat = bounty.center_lat;
  const lng = bounty.center_lng;
  ok(insideBountyArea(lat, lng, bounty.cells, bounty.area), "center is inside the bounty area (device check)");

  const session = await api.createSession({ bounty_id: bounty.id, lat, lng, accuracy_m: 6 });
  ok(session.uploads.length >= session.protocol.capture.frames, `session: quote ${session.price_quote_cents}¢, ${session.uploads.length} upload slots, challenge "${session.challenge.id}"`);

  const jpegs = files.map((f) => readFileSync(f));
  const reduce = gateReducer(session.protocol);
  const device: DeviceChecks = { hasFix: true, accuracyM: 6, insideArea: true, tiltOk: true, steady: true, tiltDeg: 2 };
  let gate: GateState = reduce(initialGate(session.frame_check_limit), { type: "DEVICE", checks: device });

  const check = async (v: MockVariant): Promise<FrameCheckResult> => {
    variant = v;
    const now = Date.now();
    gate = reduce(gate, { type: "FRAME_REQUESTED", now });
    const r = await api.frameCheck({ session_id: session.session_id, image_base64: jpegs[0]!.toString("base64") });
    gate = reduce(gate, { type: "FRAME_RESULT", result: r.result, now: Date.now(), gatePassed: r.gate_passed === true, serverStreak: r.green_streak, checksRemaining: r.checks_remaining });
    return r.result;
  };

  await check("screen_recapture");
  ok(gate.screenSuspected && gate.phase !== "ready", `screen_recapture variant is flagged, shutter locked: "${lockReason(session.protocol, gate)}"`);
  await check("default");
  ok(gate.phase === "framing" && gate.greenStreak === 1 && !gate.serverGatePassed, "one green frame after a red one does not unlock (server gate_passed false)");
  await check("default");
  ok((gate as GateState).phase === "ready", "second consecutive green frame → server gate_passed → shutter unlocks");
  variant = "default";

  gate = reduce(gate, { type: "TRIGGER" });
  gate = reduce(gate, { type: "BURST_STARTED" });
  gate = reduce(gate, { type: "BURST_DONE" });
  gate = reduce(gate, { type: "NOTE", id: "water_state", value: "still" });
  gate = reduce(gate, { type: "NOTE", id: "debris_present", value: false });
  gate = reduce(gate, { type: "SUBMIT" });
  ok(gate.phase === "uploading", "gate walked challenge → capturing → notes → uploading");

  const frames = session.uploads.slice(0, session.protocol.capture.frames);
  for (const [i, u] of frames.entries()) {
    const res = await fetch(u.signed_url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(jpegs[i % jpegs.length]!) });
    ok(res.ok, `PUT frame ${i} → ${u.path} (${res.status})`);
  }

  const t0 = Date.now();
  const sub = await api.createSubmission({
    session_id: session.session_id,
    nonce: session.nonce,
    media: frames.map((u, i) => ({ path: u.path, width: 320, height: 240, captured_at: new Date(t0 + i * 600).toISOString(), exif: { source: "api-smoke" } })),
    lat,
    lng,
    accuracy_m: 6,
    captured_at: new Date(t0).toISOString(),
    device: { model: "api-smoke", os: "node", os_version: process.version, app_version: "0.1.0" },
    sensors: { tilt_deg: 2, rotation_rate: 3, heading_deg: null, steady: true },
    field_notes: gate.notes,
    gate: { degraded: false, server_gate_passed: gate.serverGatePassed, frame_checks: gate.frameChecks, consecutive_green: gate.greenStreak, last_hint: gate.lastHint },
  });
  ok(!!sub.submission_id, `submission ${sub.submission_id} (${sub.status})`);

  const final = await new Promise<Awaited<ReturnType<typeof api.submission>>>((resolve, reject) => {
    const stop = watchSubmission({
      fetchOnce: () => api.submission(sub.submission_id),
      subscribe: null,
      onUpdate: (r) => {
        const done = r.checks.filter((c) => c.status !== "pending" && c.status !== "running").length;
        process.stdout.write(`    … ${r.status} (${done}/${r.checks.length} stages)\n`);
        if (r.status === "accepted" || r.status === "rejected" || r.status === "needs_review") resolve(r);
      },
      onError: (e) => reject(e),
    });
    setTimeout(() => {
      stop();
      reject(new Error("timed out waiting for a final status"));
    }, 60_000);
  });
  const view = resultView(final, session.protocol, { sessionOpen: true, serverRetryable: final.retryable });
  ok(true, `final: ${final.status} payout=${final.payout_cents}¢ codes=[${final.reason_codes.join(",")}] → screen "${view.title}: ${view.messages.join(" ")}"`);

  const wallet = await api.wallet();
  ok(wallet.entries.length >= 0, `wallet: balance ${wallet.balance_cents}¢, ${wallet.entries.length} entries, trust ${wallet.trust_score}`);
  console.log("smoke OK");
}

main().catch((e) => {
  console.error("  ✗", e instanceof Error ? `${e.name}: ${e.message}` : e, (e as { details?: unknown }).details ?? "");
  process.exit(1);
});
