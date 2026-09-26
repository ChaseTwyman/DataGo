/**
 * Capture gate (PRD §9.1, BUILD_PROMPT §M2) as a pure reducer.
 *
 * locating → framing → ready → challenge → capturing → notes → uploading → done
 *
 * - locating: no fix yet, accuracy > 25 m, or outside the bounty cells.
 * - framing: in the area; waiting for level + steady + 2 consecutive all-green frame checks.
 * - ready: shutter unlocked. Falls back to framing if any device check or frame check goes red.
 * - Any red frame (or screen/print suspicion) resets the green streak.
 * - Degraded: Grok frame checks erroring or slower than 10 s → device checks only,
 *   `degraded = true` (sent as `gate.degraded` with the submission).
 */
import { isFrameAllGreen, type FrameCheckResult, type Protocol } from "@groundtruth/shared";

export type GatePhase =
  | "locating"
  | "framing"
  | "ready"
  | "challenge"
  | "capturing"
  | "notes"
  | "uploading"
  | "done"
  | "ended";

export const MAX_ACCURACY_M = 25;
export const GREEN_STREAK_TO_UNLOCK = 2;
export const FRAME_INTERVAL_MS = 1200;
export const DEGRADE_AFTER_MS = 10_000;

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

export interface GateState {
  phase: GatePhase;
  device: DeviceChecks;
  greenStreak: number;
  lastFrame: FrameCheckResult | null;
  /** Latest per-element visibility (from the most recent frame check). */
  elements: Record<string, boolean>;
  screenSuspected: boolean;
  degraded: boolean;
  frameChecks: number;
  frameLimit: number;
  inFlightSince: number | null;
  lastRequestAt: number | null;
  /** First moment of the current run of Grok failures/slowness; null when healthy. */
  troubleSince: number | null;
  lastHint: string | null;
  notes: Record<string, string | number | boolean | null>;
  endReason: string | null;
  error: string | null;
}

export type GateEvent =
  | { type: "DEVICE"; checks: DeviceChecks }
  | { type: "FRAME_REQUESTED"; now: number }
  | { type: "FRAME_RESULT"; result: FrameCheckResult; now: number; checksRemaining?: number }
  | { type: "FRAME_ERROR"; now: number; message?: string }
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
    lastFrame: null,
    elements: {},
    screenSuspected: false,
    degraded: false,
    frameChecks: 0,
    frameLimit,
    inFlightSince: null,
    lastRequestAt: null,
    troubleSince: null,
    lastHint: null,
    notes: {},
    endReason: null,
    error: null,
  };
}

const PRE_CAPTURE: GatePhase[] = ["locating", "framing", "ready"];

export function locationOk(d: DeviceChecks): boolean {
  return d.hasFix && d.accuracyM !== null && d.accuracyM <= MAX_ACCURACY_M && d.insideArea;
}

export function deviceOk(d: DeviceChecks): boolean {
  return locationOk(d) && d.tiltOk && d.steady;
}

/** Shutter unlock rule. */
export function isUnlocked(s: GateState): boolean {
  if (!deviceOk(s.device)) return false;
  // A known screen/print flag survives degraded mode: degrading drops the need for fresh green
  // frames, it never erases evidence of a recapture.
  if (s.screenSuspected) return false;
  if (s.degraded) return true;
  return s.greenStreak >= GREEN_STREAK_TO_UNLOCK;
}

function derivePhase(s: GateState): GateState {
  if (!PRE_CAPTURE.includes(s.phase)) return s;
  const phase: GatePhase = !locationOk(s.device) ? "locating" : isUnlocked(s) ? "ready" : "framing";
  return phase === s.phase ? s : { ...s, phase };
}

function markTrouble(s: GateState, now: number): GateState {
  const troubleSince = s.troubleSince ?? now;
  const degraded = s.degraded || now - troubleSince >= DEGRADE_AFTER_MS;
  return { ...s, troubleSince, degraded };
}

export function gateReducer(protocol: Protocol) {
  return function reduce(s: GateState, e: GateEvent): GateState {
    switch (e.type) {
      case "DEVICE":
        return derivePhase({ ...s, device: e.checks });

      case "FRAME_REQUESTED":
        return { ...s, inFlightSince: e.now, lastRequestAt: e.now };

      case "FRAME_RESULT": {
        if (!PRE_CAPTURE.includes(s.phase)) return { ...s, inFlightSince: null };
        const green = isFrameAllGreen(protocol, e.result);
        const elements: Record<string, boolean> = {};
        for (const el of protocol.capture.required_elements) {
          const hit = e.result.elements.find((x) => x.id === el.id);
          elements[el.id] = !!hit && hit.visible && hit.confidence >= 0.5;
        }
        const slow = s.inFlightSince !== null && e.now - s.inFlightSince >= DEGRADE_AFTER_MS;
        let next: GateState = {
          ...s,
          inFlightSince: null,
          lastFrame: e.result,
          elements,
          screenSuspected: e.result.suspected_screen_or_print.value,
          greenStreak: green ? s.greenStreak + 1 : 0,
          frameChecks: s.frameChecks + 1,
          frameLimit: e.checksRemaining !== undefined ? s.frameChecks + 1 + e.checksRemaining : s.frameLimit,
          lastHint: e.result.hint || s.lastHint,
          troubleSince: slow ? s.troubleSince : null,
          error: null,
        };
        if (slow) next = markTrouble(next, e.now);
        return derivePhase(next);
      }

      case "FRAME_ERROR": {
        const next = markTrouble({ ...s, inFlightSince: null, greenStreak: 0, error: e.message ?? "frame check failed" }, e.now);
        return derivePhase(next);
      }

      case "TICK": {
        // degraded describes the conditions the burst was taken under; freeze it after capture starts
        if (!PRE_CAPTURE.includes(s.phase)) return s;
        if (s.inFlightSince !== null && e.now - s.inFlightSince >= DEGRADE_AFTER_MS) {
          return derivePhase(markTrouble({ ...s, troubleSince: s.troubleSince ?? s.inFlightSince }, e.now));
        }
        if (s.troubleSince !== null && !s.degraded && e.now - s.troubleSince >= DEGRADE_AFTER_MS) {
          return derivePhase({ ...s, degraded: true });
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
        return derivePhase({ ...s, phase: "framing", greenStreak: 0, error: e.message });

      case "NOTE":
        return { ...s, notes: { ...s.notes, [e.id]: e.value } };

      case "SUBMIT":
        return s.phase === "notes" ? { ...s, phase: "uploading", error: null } : s;

      case "UPLOAD_DONE":
        return s.phase === "uploading" ? { ...s, phase: "done" } : s;

      case "UPLOAD_FAILED":
        return s.phase === "uploading" ? { ...s, phase: "notes", error: e.message } : s;

      case "RETRY":
        // New capture inside the same session (protocol reject → one-tap retry).
        return derivePhase({ ...initialGate(s.frameLimit), device: s.device, degraded: s.degraded, frameChecks: s.frameChecks, phase: "framing" });

      case "END":
        return { ...s, phase: "ended", endReason: e.reason };
    }
  };
}

/** Frame-loop guard: every ~1.2 s, only when device checks pass and nothing is in flight. */
export function shouldRequestFrame(s: GateState, now: number, intervalMs = FRAME_INTERVAL_MS): boolean {
  if (s.phase !== "framing" && s.phase !== "ready") return false;
  if (s.degraded || s.inFlightSince !== null) return false;
  if (!deviceOk(s.device)) return false;
  if (s.frameChecks >= s.frameLimit) return false;
  return s.lastRequestAt === null || now - s.lastRequestAt >= intervalMs;
}

export interface ChecklistRow {
  id: string;
  label: string;
  ok: boolean;
  kind: "device" | "element" | "quality" | "integrity";
}

/** Rows for the overlay: device rows, then one row per required element. */
export function checklistRows(protocol: Protocol, s: GateState): ChecklistRow[] {
  const d = s.device;
  const rows: ChecklistRow[] = [
    { id: "location", label: locationLabel(d), ok: locationOk(d), kind: "device" },
    { id: "level", label: d.tiltDeg === null ? "Hold level" : `Level (${Math.round(d.tiltDeg)}°)`, ok: d.tiltOk, kind: "device" },
    { id: "steady", label: "Steady", ok: d.steady, kind: "device" },
  ];
  for (const el of protocol.capture.required_elements) {
    rows.push({ id: el.id, label: el.label, ok: s.degraded ? true : !!s.elements[el.id], kind: "element" });
  }
  if (s.screenSuspected) rows.push({ id: "screen", label: "Real scene (no screen or print)", ok: false, kind: "integrity" });
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

/** The single most important missing item, shown on the locked shutter. Null when unlocked. */
export function lockReason(protocol: Protocol, s: GateState): string | null {
  if (!PRE_CAPTURE.includes(s.phase)) return null;
  const d = s.device;
  if (!d.hasFix) return "Waiting for GPS";
  if (d.accuracyM !== null && d.accuracyM > MAX_ACCURACY_M) return "Waiting for better GPS accuracy";
  if (!d.insideArea) return "Move into the bounty area";
  if (!d.tiltOk) return "Hold the phone level";
  if (!d.steady) return "Hold steady";
  if (s.screenSuspected) return "Point at the real scene, not a screen or print";
  if (s.degraded) return null;
  if (!s.lastFrame) return "Checking the frame…";
  const missing = protocol.capture.required_elements.find((el) => !s.elements[el.id]);
  if (missing) return `Show the ${missing.label.toLowerCase()}`;
  if (!s.lastFrame.framing_ok) return s.lastFrame.hint || "Adjust the framing";
  if (!s.lastFrame.blur_ok) return "Hold still — image is blurry";
  if (!s.lastFrame.lighting_ok) return "Needs more light";
  if (s.greenStreak < GREEN_STREAK_TO_UNLOCK) return "Hold still — confirming";
  return null;
}

/** Payload for `[camera_status]` voice injection. */
export function cameraStatus(protocol: Protocol, s: GateState): { missing: string[]; hint: string | null; ready: boolean } {
  const missing: string[] = [];
  const d = s.device;
  if (!locationOk(d)) missing.push("location");
  if (!d.tiltOk) missing.push("level");
  if (!d.steady) missing.push("steady");
  if (s.screenSuspected) missing.push("real_scene");
  if (!s.degraded) for (const el of protocol.capture.required_elements) if (!s.elements[el.id]) missing.push(el.id);
  const ready = s.phase === "ready";
  const reason = lockReason(protocol, s);
  // Device problems and screen suspicion outrank the model's framing hint.
  const deviceIssue = !deviceOk(d) || s.screenSuspected;
  const hint = ready ? "Hold still." : deviceIssue ? reason : s.lastFrame?.hint || reason;
  return { missing, hint, ready };
}

/** Field questions not yet answered. */
export function notesRemaining(protocol: Protocol, s: GateState): string[] {
  return protocol.capture.field_questions.filter((q) => !(q.id in s.notes)).map((q) => q.id);
}
