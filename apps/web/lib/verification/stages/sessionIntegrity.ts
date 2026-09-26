/**
 * Layer 1 — session integrity (PRD §9.2): the submission belongs to an open server-issued session,
 * the nonce matches, it was captured within the session window, media are this session's uploads
 * (and never synthetic), and device metadata is present. Skipped for red-team/eval runs.
 *
 * Capture gate: only the server's record counts (capture_sessions.gate_passed_at, written by the
 * frame-check route). A session that never passed gets GATE_NOT_PASSED, and the phone's own
 * gate.degraded claim gets GATE_DEGRADED; both cap the decision at needs_review (no auto-pay).
 */
import { GATE_REQUIRED_GREEN, judgeLateUpload, type ReasonCode, type Subcheck } from "@groundtruth/shared";
import { nonObservationPaths } from "../syntheticGuard";
import type { Stage, StageOutcome } from "../types";

/** Clock skew allowed between phone and server. */
const GRACE_MS = 2 * 60_000;

export const sessionIntegrity: Stage = {
  id: "session_integrity",
  async run({ input }): Promise<StageOutcome> {
    if (input.source !== "live") {
      return { status: "skipped", score: null, reasonCodes: [], evidence: [`${input.source} run: no live session`] };
    }
    const codes: ReasonCode[] = [];
    const sub: Subcheck[] = [];
    const evidence: string[] = [];
    const fail = (id: string, label: string, code: ReasonCode, detail: string) => {
      sub.push({ id, label, status: "fail", detail });
      codes.push(code);
      evidence.push(detail);
    };
    const ok = (id: string, label: string, detail?: string) => sub.push({ id, label, status: "pass", ...(detail ? { detail } : {}) });

    const paths = input.frames.map((f) => f.path);
    const synthetic = nonObservationPaths(paths);
    if (synthetic.length > 0) {
      fail("media_bucket", "Media from the camera bucket", "SYNTHETIC_MEDIA", `Non-observation media refused: ${synthetic.join(", ")}`);
      return { status: "fail", score: 0, reasonCodes: codes, evidence, subchecks: sub };
    }

    const s = input.session;
    if (!s) {
      fail("session", "Capture session", "SESSION_INVALID", "No capture session for this submission");
      return { status: "fail", score: 0, reasonCodes: codes, evidence, subchecks: sub };
    }
    if (s.user_id !== input.userId) fail("owner", "Session owner", "SESSION_INVALID", "Session belongs to another user");
    else ok("owner", "Session owner");

    if (!input.nonce || input.nonce !== s.nonce) fail("nonce", "Nonce", "SESSION_INVALID", "Nonce does not match the session");
    else ok("nonce", "Nonce");

    if (s.status === "expired" || s.status === "abandoned") {
      fail("status", "Session open", "SESSION_EXPIRED", `Session is ${s.status}`);
    } else ok("status", "Session open");

    const captured = Date.parse(input.captured_at);
    const received = Date.parse(input.received_at);
    const start = Date.parse(s.started_at);
    const end = Date.parse(s.expires_at);
    // A queued upload (phone lost signal after the burst) may be received late, within the bounded
    // grace, only when the server gate passed (shared judgeLateUpload; missions track, migration 000010).
    const late = received > end + GRACE_MS ? judgeLateUpload(s, input.captured_at, new Date(received)) : null;
    if (captured < start - GRACE_MS || captured > end + GRACE_MS || (late !== null && !late.ok)) {
      fail("window", "Captured within session", "SESSION_EXPIRED", "Capture time is outside the 15-minute session window");
    } else ok("window", "Captured within session", late?.ok ? "Uploaded late from the phone queue (gate passed; within grace)" : undefined);

    const allowed = new Set(s.upload_paths);
    const foreign = paths.filter((p) => !allowed.has(p));
    if (foreign.length > 0) fail("uploads", "Session uploads", "SESSION_INVALID", `Media not issued to this session: ${foreign.join(", ")}`);
    else ok("uploads", "Session uploads");

    const missing = input.frames.filter((f) => !f.bytes).map((f) => f.path);
    if (missing.length > 0) fail("present", "Frames uploaded", "SESSION_INVALID", `Missing uploads: ${missing.join(", ")}`);
    else ok("present", "Frames uploaded", `${input.frames.length} frame(s)`);

    if (!input.device.os) {
      fail("device", "Device metadata", "SESSION_INVALID", "Device metadata missing");
    } else ok("device", "Device metadata", [input.device.model, input.device.os, input.device.os_version].filter(Boolean).join(" "));

    let status: StageOutcome["status"] = codes.length > 0 ? "fail" : "pass";
    const expected = input.protocol.capture.frames;
    if (status === "pass" && input.frames.length < expected) {
      sub.push({ id: "frames", label: "Burst length", status: "warn", detail: `${input.frames.length} of ${expected} frames` });
      status = "warn";
    }
    const score = codes.length > 0 ? 0 : 1;

    const phone = `phone reported ${input.gate.degraded ? "a degraded gate" : "gate passed"} after ${input.gate.frame_checks ?? "?"} check(s)`;
    if (s.gate_passed_at) {
      sub.push({ id: "gate", label: "Capture gate (server)", status: "pass", detail: `Passed at ${s.gate_passed_at}; ${phone}` });
    } else {
      sub.push({
        id: "gate",
        label: "Capture gate (server)",
        status: "warn",
        detail: `Server never recorded ${GATE_REQUIRED_GREEN} consecutive all-green frame checks (${s.frame_checks} check(s), streak ${s.green_streak}); ${phone}`,
      });
      codes.push("GATE_NOT_PASSED");
      evidence.push("Capture gate never passed on the server: capped at review, no automatic payout");
      if (status === "pass") status = "warn";
    }
    if (input.gate.degraded) {
      codes.push("GATE_DEGRADED");
      evidence.push("Phone reports its capture gate ran degraded (device checks only)");
      if (status === "pass") status = "warn";
    }
    return { status, score, reasonCodes: codes, evidence, subchecks: sub };
  },
};
