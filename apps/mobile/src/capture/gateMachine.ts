/**
 * Capture gate (PRD §9.1, BUILD_PROMPT §M2) as a pure reducer.
 *
 *   locating ──in area──▶ framing ──server gate_passed + device ok + no screen──▶ ready ─TRIGGER─▶ challenge
 *      ▲                   │  ▲                                                     │
 *      └── location lost ──┤  └──────── device wobble / red frame / error ──────────┘
 *                          ▼
 *                     cant_verify  (frame checks keep failing, a request is stalled, the server
 *                                   refused us (4xx / off-contract), or the 90-check cap is spent)
 *
 * challenge → capturing → notes → uploading → done;  END from anywhere → ended.
 *
 * Unlock rule (the only way to `ready`): the LATEST frame-check response said `gate_passed` (the
 * server counts GATE_REQUIRED_GREEN consecutive all-green real-model checks), the phone's own
 * device checks pass, and there is no screen/print flag. Local green counting is UI feedback only.
 *
 * There is deliberately NO degraded unlock. It used to be "Grok erroring/slow for 10 s → unlock on
 * device checks alone"; a tester unlocked the shutter pointing at a vitamin-water bottle on a
 * street-flood bounty that way (frame_checks 0, degraded true). Level/steady/GPS cannot tell a
 * bottle from a flood, so when the scene cannot be verified the shutter stays locked and we retry
 * with backoff until the per-session cap.
 */
import { isFrameAllGreen, type FrameCheckResult, type Protocol } from "@groundtruth/shared";

export type GatePhase =
  | "locating"
  | "framing"
  | "cant_verify"
  | "ready"
  | "challenge"
  | "capturing"
  | "notes"
  | "uploading"
  | "done"
  | "ended";

export const MAX_ACCURACY_M = 25;
/** Mirrors the server's GATE_REQUIRED_GREEN; used only for UI feedback ("confirming 1/2"). */
export const GREEN_STREAK_TO_UNLOCK = 2;
export const FRAME_INTERVAL_MS = 1200;
/** Retry delays after 1, 2, 3, 4+ consecutive failures. */
export const BACKOFF_MS = [1200, 2000, 4000, 5000] as const;
/** Consecutive failures before the gate shows CAN'T VERIFY SCENE (one blip is not worth alarming). */
export const CANT_VERIFY_AFTER_FAILURES = 2;
/** A request still in flight this long also counts as "can't verify" (HTTP times out at 12 s). */
export const STALL_MS = 8000;

export interface DeviceChecks {
  hasFix: boolean;
  accuracyM: number | null;
  insideArea: boolean;
  tiltOk: boolean;
  steady: boolean;
  tiltDeg: number | null;
  distanceM?: number | null;
}

export const NO_DEVICE: DeviceChecks = {
  hasFix: false,
  accuracyM: null,
  insideArea: false,
  tiltOk: false,
  steady: false,
  tiltDeg: null,
  distanceM: null,
};

/** How a failed frame check should be handled. */
export type FrameErrorKind = "retry" | "fatal" | "limit";

export interface GateState {
  phase: GatePhase;
  device: DeviceChecks;
  /** Local consecutive all-green count — UI feedback only, never unlocks. */
  greenStreak: number;
  /** Server-side consecutive all-green count from the latest response. */
  serverStreak: number;
  /** `gate_passed` from the LATEST frame-check response; cleared by any failure. */
  serverGatePassed: boolean;
  lastFrame: FrameCheckResult | null;
  /** Latest per-element visibility (from the most recent frame check). */
  elements: Record<string, boolean>;
  screenSuspected: boolean;
  /** Successful frame-check responses. */
  frameChecks: number;
  /** Requests sent (successes + failures); never exceeds frameLimit. */
  attempts: number;
  /** Per-session cap from the session (90). */
  frameLimit: number;
  /** Server's checks_remaining from the latest response (null until the first one). */
  checksRemaining: number | null;
  inFlightSince: number | null;
  lastRequestAt: number | null;
  /** Consecutive failed frame checks; drives the backoff and the CAN'T VERIFY state. */
  failStreak: number;
  /** A request has been in flight ≥ STALL_MS. */
  stalled: boolean;
  /** Server refused in a way retrying cannot fix (4xx, off-contract response). Terminal. */
  fatal: string | null;
  /** Server said the per-session frame-check limit is spent. Terminal. */
  limitReached: boolean;
  lastHint: string | null;
  notes: Record<string, string | number | boolean | null>;
  endReason: string | null;
  error: string | null;
}

export type GateEvent =
  | { type: "DEVICE"; checks: DeviceChecks }
  | { type: "FRAME_REQUESTED"; now: number }
  | {
      type: "FRAME_RESULT";
      result: FrameCheckResult;
      now: number;
      /** Server's authoritative gate decision for this session. */
      gatePassed: boolean;
      serverStreak?: number;
      checksRemaining?: number;
    }
  | { type: "FRAME_ERROR"; now: number; message?: string; kind?: FrameErrorKind }
  | { type: "TICK"; now: number }
  | { type: "TRIGGER" }
  | { type: "BURST_STARTED" }
  | { type: "BURST_DONE" }
  | { type: "BURST_FAILED"; message: string }
  | { type: "NOTE"; id: string; value: string | number | boolean | null }
  | { type: "SUBMIT" }
  | { type: "UPLOAD_DONE" }
  | { type: "UPLOAD_FAILED"; message: string }
  | { type: "RETRY" }
  | { type: "END"; reason: string };

export function initialGate(frameLimit = 90): GateState {
  return {
    phase: "locating",
    device: NO_DEVICE,
    greenStreak: 0,
    serverStreak: 0,
    serverGatePassed: false,
    lastFrame: null,
    elements: {},
    screenSuspected: false,
    frameChecks: 0,
    attempts: 0,
    frameLimit,
    checksRemaining: null,
    inFlightSince: null,
    lastRequestAt: null,
    failStreak: 0,
    stalled: false,
    fatal: null,
    limitReached: false,
    lastHint: null,
    notes: {},
    endReason: null,
    error: null,
  };
}

const PRE_CAPTURE: readonly GatePhase[] = ["locating", "framing", "cant_verify", "ready"];

export function isPreCapture(phase: GatePhase): boolean {
  return PRE_CAPTURE.includes(phase);
}

export function locationOk(d: DeviceChecks): boolean {
  return d.hasFix && d.accuracyM !== null && d.accuracyM <= MAX_ACCURACY_M && d.insideArea;
}

export function deviceOk(d: DeviceChecks): boolean {
  return locationOk(d) && d.tiltOk && d.steady;
}

/** Retry delay after `failStreak` consecutive failures (0 → normal cadence). */
export function backoffMs(failStreak: number): number {
  if (failStreak <= 0) return FRAME_INTERVAL_MS;
  return BACKOFF_MS[Math.min(failStreak, BACKOFF_MS.length) - 1]!;
}

/** No more frame checks may be sent this session. */
export function checksExhausted(s: GateState): boolean {
  return s.limitReached || s.attempts >= s.frameLimit || s.checksRemaining === 0;
}

export type VerifyStatus = "ok" | "retrying" | "cant_verify" | "failed" | "exhausted";

/** Health of the server scene check, independent of the device checks. */
export function verifyStatus(s: GateState): VerifyStatus {
  if (s.fatal) return "failed";
  if (checksExhausted(s) && !s.serverGatePassed) return "exhausted";
  if (s.failStreak >= CANT_VERIFY_AFTER_FAILURES || s.stalled) return "cant_verify";
  if (s.failStreak > 0) return "retrying";
  return "ok";
}

/** Shutter unlock rule: server says passed, device says ok, nothing looks like a screen/print. */
export function isUnlocked(s: GateState): boolean {
  if (!deviceOk(s.device)) return false;
  if (s.screenSuspected) return false;
  if (s.fatal) return false;
  return s.serverGatePassed;
}

function derivePhase(s: GateState): GateState {
  if (!PRE_CAPTURE.includes(s.phase)) return s;
  const v = verifyStatus(s);
  const phase: GatePhase = !locationOk(s.device)
    ? "locating"
    : isUnlocked(s)
      ? "ready"
      : v === "cant_verify" || v === "failed" || v === "exhausted"
        ? "cant_verify"
        : "framing";
  return phase === s.phase ? s : { ...s, phase };
}

export function gateReducer(protocol: Protocol) {
  return function reduce(s: GateState, e: GateEvent): GateState {
    switch (e.type) {
      case "DEVICE":
        return derivePhase({ ...s, device: e.checks });

      case "FRAME_REQUESTED":
        return { ...s, inFlightSince: e.now, lastRequestAt: e.now, attempts: s.attempts + 1 };

      case "FRAME_RESULT": {
        if (!PRE_CAPTURE.includes(s.phase)) return { ...s, inFlightSince: null, stalled: false };
        const green = isFrameAllGreen(protocol, e.result);
        const elements: Record<string, boolean> = {};
        for (const el of protocol.capture.required_elements) {
          const hit = e.result.elements.find((x) => x.id === el.id);
          elements[el.id] = !!hit && hit.visible && hit.confidence >= 0.5;
        }
        const screen = e.result.suspected_screen_or_print.value;
        return derivePhase({
          ...s,
          inFlightSince: null,
          stalled: false,
          failStreak: 0,
          lastFrame: e.result,
          elements,
          screenSuspected: screen,
          greenStreak: green ? s.greenStreak + 1 : 0,
          // strict boolean: anything but an explicit true from the server keeps the shutter locked
          serverGatePassed: e.gatePassed === true && !screen,
          serverStreak: e.serverStreak ?? 0,
          frameChecks: s.frameChecks + 1,
          checksRemaining: e.checksRemaining ?? s.checksRemaining,
          lastHint: e.result.hint || s.lastHint,
          error: null,
        });
      }

      case "FRAME_ERROR": {
        const kind = e.kind ?? "retry";
        const message = e.message ?? "frame check failed";
        return derivePhase({
          ...s,
          inFlightSince: null,
          stalled: false,
          greenStreak: 0,
          serverStreak: 0,
          serverGatePassed: false,
          failStreak: s.failStreak + 1,
          fatal: kind === "fatal" ? message : s.fatal,
          limitReached: s.limitReached || kind === "limit",
          error: message,
        });
      }

      case "TICK": {
        if (!PRE_CAPTURE.includes(s.phase)) return s;
        if (!s.stalled && s.inFlightSince !== null && e.now - s.inFlightSince >= STALL_MS) {
          return derivePhase({ ...s, stalled: true });
        }
        return s;
      }

      case "TRIGGER":
        if (s.phase !== "ready" || !isUnlocked(s)) return s;
        return { ...s, phase: "challenge" };

      case "BURST_STARTED":
        return s.phase === "challenge" ? { ...s, phase: "capturing" } : s;

      case "BURST_DONE":
        return s.phase === "capturing" || s.phase === "challenge" ? { ...s, phase: "notes" } : s;

      case "BURST_FAILED":
        if (s.phase !== "capturing" && s.phase !== "challenge") return s;
        // A new capture needs a fresh server pass.
        return derivePhase({ ...s, phase: "framing", greenStreak: 0, serverStreak: 0, serverGatePassed: false, error: e.message });

      case "NOTE":
        return { ...s, notes: { ...s.notes, [e.id]: e.value } };

      case "SUBMIT":
        return s.phase === "notes" ? { ...s, phase: "uploading", error: null } : s;

      case "UPLOAD_DONE":
        return s.phase === "uploading" ? { ...s, phase: "done" } : s;

      case "UPLOAD_FAILED":
        return s.phase === "uploading" ? { ...s, phase: "notes", error: e.message } : s;

      case "RETRY":
        // New capture inside the same session (protocol reject → one-tap retry). The session's
        // check budget and any terminal server refusal carry over; the server pass does not.
        return derivePhase({
          ...initialGate(s.frameLimit),
          device: s.device,
          frameChecks: s.frameChecks,
          attempts: s.attempts,
          checksRemaining: s.checksRemaining,
          fatal: s.fatal,
          limitReached: s.limitReached,
          phase: "framing",
        });

      case "END":
        return { ...s, phase: "ended", endReason: e.reason };
    }
  };
}

/**
 * Frame-loop guard: only before capture, only when device checks pass, one in flight, never past
 * the per-session cap or after a terminal refusal. Normal cadence 1.2 s; after failures it backs
 * off 1.2 → 2 → 4 → 5 s.
 */
export function shouldRequestFrame(s: GateState, now: number): boolean {
  if (!PRE_CAPTURE.includes(s.phase) || s.phase === "locating") return false;
  if (s.inFlightSince !== null) return false;
  if (s.fatal || checksExhausted(s)) return false;
  if (!deviceOk(s.device)) return false;
  return s.lastRequestAt === null || now - s.lastRequestAt >= backoffMs(s.failStreak);
}

/**
 * Map a frame-check failure to how the gate treats it. Duck-typed on ApiError (status + code).
 * - 429 FRAME_CHECK_LIMIT → limit (terminal); 429 in-flight, 408, 5xx, network/timeout, camera → retry.
 * - Any other 4xx, or a response that does not match the shared contract → fatal: retrying the
 *   same request cannot fix it, so surface it instead of looping.
 */
export function classifyFrameError(e: unknown): FrameErrorKind {
  if (!e || typeof e !== "object") return "retry";
  const { status, code } = e as { status?: unknown; code?: unknown };
  if (code === "FRAME_CHECK_LIMIT") return "limit";
  if (code === "CONTRACT_MISMATCH" || code === "BAD_JSON") return "fatal";
  if (typeof status !== "number") return "retry";
  if (status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "fatal";
  return "retry";
}

export interface ChecklistRow {
  id: string;
  label: string;
  ok: boolean;
  kind: "device" | "element" | "quality" | "integrity";
}

/** Rows for the overlay: device rows, one row per required element, then the server verification. */
export function checklistRows(protocol: Protocol, s: GateState): ChecklistRow[] {
  const d = s.device;
  const rows: ChecklistRow[] = [
    { id: "location", label: locationLabel(d), ok: locationOk(d), kind: "device" },
    { id: "level", label: d.tiltDeg === null ? "Hold level" : `Level (${Math.round(d.tiltDeg)}°)`, ok: d.tiltOk, kind: "device" },
    { id: "steady", label: "Steady", ok: d.steady, kind: "device" },
  ];
  for (const el of protocol.capture.required_elements) {
    rows.push({ id: el.id, label: el.label, ok: !!s.elements[el.id], kind: "element" });
  }
  if (s.screenSuspected) rows.push({ id: "screen", label: "Real scene (no screen or print)", ok: false, kind: "integrity" });
  rows.push({
    id: "verified",
    label: s.serverGatePassed ? "Scene verified" : `Scene verified (${Math.min(s.serverStreak, GREEN_STREAK_TO_UNLOCK)}/${GREEN_STREAK_TO_UNLOCK})`,
    ok: s.serverGatePassed,
    kind: "integrity",
  });
  return rows;
}

function locationLabel(d: DeviceChecks): string {
  if (!d.hasFix) return "Finding GPS…";
  if (d.accuracyM !== null && d.accuracyM > MAX_ACCURACY_M) return `GPS accuracy ${Math.round(d.accuracyM)} m (need ≤ ${MAX_ACCURACY_M} m)`;
  if (!d.insideArea) return d.distanceM ? `Outside area (${formatDistance(d.distanceM)} away)` : "Outside bounty area";
  return "In bounty area";
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export const CANT_VERIFY_MESSAGE = "Can't verify the scene right now. Checking again…";
export const CHECK_FAILED_MESSAGE = "Scene check unavailable. End this session and start a new one.";
export const LIMIT_MESSAGE = "Scene-check limit reached. End this session and start a new one.";

/** User-facing copy for the scene-verification problem, or null when there is none. */
export function verifyMessage(s: GateState): string | null {
  switch (verifyStatus(s)) {
    case "failed":
      return CHECK_FAILED_MESSAGE;
    case "exhausted":
      return LIMIT_MESSAGE;
    case "cant_verify":
      return CANT_VERIFY_MESSAGE;
    default:
      return null;
  }
}

/** Short plain-language cause for the CAN'T VERIFY banner, from the last error message. */
export function verifyCause(s: GateState): string {
  if (s.stalled) return "The scene check is taking too long — weak connection or a busy server.";
  const m = (s.error ?? "").toLowerCase();
  if (/timed out|timeout|network/.test(m)) return "No connection to the scene checker.";
  if (/busy|unavailable|grok|502|503|504|in flight|already running/.test(m)) return "The scene checker is busy.";
  if (/camera|snapshot/.test(m)) return "The camera preview could not be read.";
  return "The scene checker did not answer.";
}

/** The single most important missing item, shown on the locked shutter. Null when unlocked. */
export function lockReason(protocol: Protocol, s: GateState): string | null {
  if (!PRE_CAPTURE.includes(s.phase)) return null;
  if (s.phase === "ready") return null;
  const d = s.device;
  if (!d.hasFix) return "Waiting for GPS";
  if (d.accuracyM !== null && d.accuracyM > MAX_ACCURACY_M) return "Waiting for better GPS accuracy";
  if (!d.insideArea) return "Move into the bounty area";
  // Terminal problems first: holding level cannot fix them.
  const v = verifyStatus(s);
  if (v === "failed" || v === "exhausted") return verifyMessage(s);
  if (!d.tiltOk) return "Hold the phone level";
  if (!d.steady) return "Hold steady";
  if (s.screenSuspected) return "Point at the real scene, not a screen or print";
  if (v === "cant_verify") return CANT_VERIFY_MESSAGE;
  if (!s.lastFrame) return "Checking the frame…";
  const missing = protocol.capture.required_elements.find((el) => !s.elements[el.id]);
  if (missing) return `Show the ${missing.label.toLowerCase()}`;
  if (!s.lastFrame.framing_ok) return s.lastFrame.hint || "Adjust the framing";
  if (!s.lastFrame.blur_ok) return "Hold still — image is blurry";
  if (!s.lastFrame.lighting_ok) return "Needs more light";
  return "Hold still — confirming";
}

/** Payload for `[camera_status]` voice injection. */
export function cameraStatus(protocol: Protocol, s: GateState): { missing: string[]; hint: string | null; ready: boolean } {
  const missing: string[] = [];
  const d = s.device;
  if (!locationOk(d)) missing.push("location");
  if (!d.tiltOk) missing.push("level");
  if (!d.steady) missing.push("steady");
  if (s.screenSuspected) missing.push("real_scene");
  for (const el of protocol.capture.required_elements) if (!s.elements[el.id]) missing.push(el.id);
  const ready = s.phase === "ready";
  if (!ready && !s.serverGatePassed) missing.push("scene_verified");
  const reason = lockReason(protocol, s);
  // Device problems, screen suspicion and verification trouble outrank the model's framing hint
  // (a stale hint from the last good frame would be misleading while we can't verify).
  const overrides = !deviceOk(d) || s.screenSuspected || verifyStatus(s) !== "ok";
  const hint = ready ? "Hold still." : overrides ? reason : s.lastFrame?.hint || reason;
  return { missing, hint, ready };
}

/** Field questions not yet answered. */
export function notesRemaining(protocol: Protocol, s: GateState): string[] {
  return protocol.capture.field_questions.filter((q) => !(q.id in s.notes)).map((q) => q.id);
}
