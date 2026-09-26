import { streetFloodDepth, type FrameCheckResult } from "@groundtruth/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/http";
import {
  backoffMs,
  CANT_VERIFY_MESSAGE,
  cameraStatus,
  checklistRows,
  classifyFrameError,
  gateReducer,
  initialGate,
  isUnlocked,
  LIMIT_MESSAGE,
  CHECK_FAILED_MESSAGE,
  lockReason,
  notesRemaining,
  shouldRequestFrame,
  STALL_MS,
  verifyCause,
  verifyStatus,
  type DeviceChecks,
  type GateEvent,
  type GateState,
} from "../src/capture/gateMachine";

const reduce = gateReducer(streetFloodDepth);
const run = (events: GateEvent[], s: GateState = initialGate()) => events.reduce(reduce, s);

const GOOD_DEVICE: DeviceChecks = { hasFix: true, accuracyM: 8, insideArea: true, tiltOk: true, steady: true, tiltDeg: 3 };

function frame(over: Partial<FrameCheckResult> = {}, visible: string[] = ["water_surface", "reference_object", "waterline"]): FrameCheckResult {
  return {
    elements: streetFloodDepth.capture.required_elements.map((e) => ({ id: e.id, visible: visible.includes(e.id), confidence: 0.9 })),
    framing_ok: true,
    blur_ok: true,
    lighting_ok: true,
    suspected_screen_or_print: { value: false, confidence: 0.05 },
    hint: "Hold still.",
    ...over,
  };
}

/** One request + response. `passed` is the server's gate_passed. */
const check = (now: number, passed: boolean, result: FrameCheckResult = frame(), streak = passed ? 2 : 1): GateEvent[] => [
  { type: "FRAME_REQUESTED", now },
  { type: "FRAME_RESULT", result, now: now + 500, gatePassed: passed, serverStreak: streak },
];
const fail = (now: number, message = "Network error"): GateEvent[] => [
  { type: "FRAME_REQUESTED", now },
  { type: "FRAME_ERROR", now: now + 100, message },
];
const DEV: GateEvent = { type: "DEVICE", checks: GOOD_DEVICE };
/** Server-approved, device ok → ready. */
const ready = () => run([DEV, ...check(0, false), ...check(1200, true)]);

describe("gate: location", () => {
  it("starts locating and stays there without a good fix", () => {
    expect(initialGate().phase).toBe("locating");
    expect(run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, accuracyM: 40 } }]).phase).toBe("locating");
    expect(run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, insideArea: false } }]).phase).toBe("locating");
    expect(run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, hasFix: false } }]).phase).toBe("locating");
  });

  it("accuracy exactly 25 m counts; inside area → framing", () => {
    expect(run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, accuracyM: 25 } }]).phase).toBe("framing");
  });
});

describe("gate: unlock requires the server's gate_passed", () => {
  it("local all-green frames never unlock without server gate_passed", () => {
    let s = run([DEV]);
    for (let i = 0; i < 10; i++) s = run(check(i * 1200, false, frame(), i + 1), s);
    expect(s.greenStreak).toBe(10); // local count still runs, for UI
    expect(isUnlocked(s)).toBe(false);
    expect(s.phase).toBe("framing");
    expect(reduce(s, { type: "TRIGGER" }).phase).toBe("framing");
  });

  it("server gate_passed + device ok + no screen → ready", () => {
    const s = ready();
    expect(s.phase).toBe("ready");
    expect(isUnlocked(s)).toBe(true);
    expect(reduce(s, { type: "TRIGGER" }).phase).toBe("challenge");
  });

  it("server gate_passed but device checks fail → locked", () => {
    let s = run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, tiltOk: false } }, ...check(0, true)]);
    expect(s.serverGatePassed).toBe(true);
    expect(isUnlocked(s)).toBe(false);
    expect(s.phase).toBe("framing");
    expect(lockReason(streetFloodDepth, s)).toBe("Hold the phone level");
    s = reduce(s, { type: "DEVICE", checks: { ...GOOD_DEVICE, steady: false } });
    expect(s.phase).toBe("framing");
    s = reduce(s, DEV);
    expect(s.phase).toBe("ready");
  });

  it("only the LATEST response counts: a later gate_passed=false re-locks", () => {
    let s = ready();
    s = run(check(2400, false, frame({ blur_ok: false }), 0), s);
    expect(s.phase).toBe("framing");
    expect(isUnlocked(s)).toBe(false);
  });

  it("losing level or steadiness re-locks; regaining it with the pass still current re-unlocks", () => {
    let s = reduce(ready(), { type: "DEVICE", checks: { ...GOOD_DEVICE, steady: false } });
    expect(s.phase).toBe("framing");
    expect(lockReason(streetFloodDepth, s)).toBe("Hold steady");
    s = reduce(s, DEV);
    expect(s.phase).toBe("ready");
  });

  it("screen/print flag always locks, even when the server claims gate_passed", () => {
    const screen = frame({ suspected_screen_or_print: { value: true, confidence: 0.9 } });
    const s = run([DEV, ...check(0, true, screen), ...check(1200, true, screen)]);
    expect(s.phase).toBe("framing");
    expect(isUnlocked(s)).toBe(false);
    expect(s.screenSuspected).toBe(true);
    expect(lockReason(streetFloodDepth, s)).toMatch(/screen or print/);
    expect(checklistRows(streetFloodDepth, s).find((r) => r.id === "screen")?.ok).toBe(false);
    expect(cameraStatus(streetFloodDepth, s).missing).toContain("real_scene");
  });

  it("both layers enforce the screen flag: reducer drops the pass, isUnlocked refuses", () => {
    const screen = frame({ suspected_screen_or_print: { value: true, confidence: 0.9 } });
    expect(run([DEV, ...check(0, true, screen)]).serverGatePassed).toBe(false);
    expect(isUnlocked({ ...ready(), screenSuspected: true })).toBe(false);
  });

  it("a non-boolean gate_passed is not treated as a pass", () => {
    const s = run([DEV, { type: "FRAME_REQUESTED", now: 0 }, { type: "FRAME_RESULT", result: frame(), now: 1, gatePassed: "true" as unknown as boolean }]);
    expect(isUnlocked(s)).toBe(false);
  });
});

describe("gate: no degraded unlock — CAN'T VERIFY SCENE", () => {
  it("one failure is a retry, two in a row is cant_verify; shutter stays locked", () => {
    let s = run([DEV, ...fail(0)]);
    expect(verifyStatus(s)).toBe("retrying");
    expect(s.phase).toBe("framing");
    s = run(fail(1300), s);
    expect(verifyStatus(s)).toBe("cant_verify");
    expect(s.phase).toBe("cant_verify");
    expect(isUnlocked(s)).toBe(false);
    expect(lockReason(streetFloodDepth, s)).toBe(CANT_VERIFY_MESSAGE);
  });

  it("never unlocks after 10 s or 60 s of failures (the vitamin-water incident)", () => {
    let s = run([DEV]);
    let now = 0;
    while (now <= 60_000) {
      if (shouldRequestFrame(s, now)) s = run(fail(now), s);
      s = reduce(s, { type: "TICK", now });
      expect(isUnlocked(s)).toBe(false);
      expect(s.phase).not.toBe("ready");
      if (now >= 10_000) expect(s.phase).toBe("cant_verify");
      now += 300;
    }
    expect(s.frameChecks).toBe(0);
    expect(reduce(s, { type: "TRIGGER" }).phase).toBe("cant_verify");
    // and it kept retrying the whole time, at ≤ 5 s spacing
    expect(s.attempts).toBeGreaterThanOrEqual(12);
  });

  it("a request stalled ≥ 8 s shows cant_verify via TICK, still locked", () => {
    let s = run([DEV, { type: "FRAME_REQUESTED", now: 0 }]);
    s = reduce(s, { type: "TICK", now: STALL_MS - 1 });
    expect(s.phase).toBe("framing");
    s = reduce(s, { type: "TICK", now: STALL_MS });
    expect(s.phase).toBe("cant_verify");
    expect(isUnlocked(s)).toBe(false);
  });

  it("a failure after unlocking re-locks (the pass is no longer the latest response)", () => {
    const s = run(fail(2400), ready());
    expect(s.phase).toBe("framing");
    expect(isUnlocked(s)).toBe(false);
  });

  it("recovers after errors once the server passes", () => {
    let s = run([DEV, ...fail(0), ...fail(1300), ...fail(3400)]);
    expect(s.phase).toBe("cant_verify");
    s = run(check(7500, false, frame(), 1), s);
    expect(s.phase).toBe("framing");
    expect(verifyStatus(s)).toBe("ok");
    expect(s.failStreak).toBe(0);
    s = run(check(8700, true), s);
    expect(s.phase).toBe("ready");
  });

  it("screen flag still locks after recovering from errors", () => {
    const screen = frame({ suspected_screen_or_print: { value: true, confidence: 0.9 } });
    const s = run([DEV, ...fail(0), ...fail(1300), ...check(3400, true, screen)]);
    expect(isUnlocked(s)).toBe(false);
  });

  it("voice camera_status says it can't verify and is checking again", () => {
    const s = run([DEV, ...check(0, false, frame({ hint: "Tilt down to the waterline" })), ...fail(1200), ...fail(2500)]);
    const cs = cameraStatus(streetFloodDepth, s);
    expect(cs.ready).toBe(false);
    expect(cs.hint).toBe(CANT_VERIFY_MESSAGE); // not the stale model hint
    expect(cs.missing).toContain("scene_verified");
  });
});

describe("gate: backoff + cap", () => {
  it("backoff schedule 1.2 → 2 → 4 → 5 s, capped at 5 s", () => {
    expect([0, 1, 2, 3, 4, 9].map(backoffMs)).toEqual([1200, 1200, 2000, 4000, 5000, 5000]);
  });

  it("the frame loop honours the backoff after failures", () => {
    let s = run([DEV, ...fail(0)]);
    expect(shouldRequestFrame(s, 1199)).toBe(false);
    expect(shouldRequestFrame(s, 1200)).toBe(true);
    s = run(fail(1200), s);
    expect(shouldRequestFrame(s, 1200 + 1999)).toBe(false);
    expect(shouldRequestFrame(s, 1200 + 2000)).toBe(true);
    s = run(fail(3200), s);
    expect(shouldRequestFrame(s, 3200 + 3999)).toBe(false);
    expect(shouldRequestFrame(s, 3200 + 4000)).toBe(true);
    s = run([...fail(7200), ...fail(12_200)], s);
    expect(shouldRequestFrame(s, 12_200 + 4999)).toBe(false);
    expect(shouldRequestFrame(s, 12_200 + 5000)).toBe(true);
  });

  it("requests only when device checks pass, nothing in flight, and ≥ 1.2 s since last", () => {
    let s = run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, tiltOk: false } }]);
    expect(shouldRequestFrame(s, 0)).toBe(false);
    s = reduce(s, DEV);
    expect(shouldRequestFrame(s, 0)).toBe(true);
    s = reduce(s, { type: "FRAME_REQUESTED", now: 0 });
    expect(shouldRequestFrame(s, 5000)).toBe(false); // in flight
    s = reduce(s, { type: "FRAME_RESULT", result: frame(), now: 600, gatePassed: false });
    expect(shouldRequestFrame(s, 1100)).toBe(false);
    expect(shouldRequestFrame(s, 1200)).toBe(true);
  });

  it("failed attempts count toward the per-session cap; cap reached → terminal message, no more requests", () => {
    let s = run([DEV], initialGate(5));
    let now = 0;
    for (let i = 0; i < 20; i++) {
      now += 6000;
      if (shouldRequestFrame(s, now)) s = run(fail(now), s);
    }
    expect(s.attempts).toBe(5);
    expect(verifyStatus(s)).toBe("exhausted");
    expect(s.phase).toBe("cant_verify");
    expect(lockReason(streetFloodDepth, s)).toBe(LIMIT_MESSAGE);
    expect(shouldRequestFrame(s, now + 60_000)).toBe(false);
  });

  it("server checks_remaining 0 stops the loop; not passed → terminal", () => {
    const s = run([DEV, { type: "FRAME_REQUESTED", now: 0 }, { type: "FRAME_RESULT", result: frame(), now: 100, gatePassed: false, checksRemaining: 0 }]);
    expect(shouldRequestFrame(s, 5000)).toBe(false);
    expect(lockReason(streetFloodDepth, s)).toBe(LIMIT_MESSAGE);
  });

  it("server 429 FRAME_CHECK_LIMIT is terminal", () => {
    const s = run([DEV, { type: "FRAME_REQUESTED", now: 0 }, { type: "FRAME_ERROR", now: 1, kind: "limit", message: "limit" }]);
    expect(verifyStatus(s)).toBe("exhausted");
    expect(shouldRequestFrame(s, 60_000)).toBe(false);
  });
});

describe("gate: server refusals are surfaced, not looped", () => {
  it("classifies errors: 4xx/off-contract fatal; 5xx/network/429-in-flight retry; limit", () => {
    expect(classifyFrameError(new ApiError(401, "UNAUTHORIZED", "x"))).toBe("fatal");
    expect(classifyFrameError(new ApiError(409, "SESSION_CLOSED", "x"))).toBe("fatal");
    expect(classifyFrameError(new ApiError(400, "BAD_REQUEST", "x"))).toBe("fatal");
    expect(classifyFrameError(new ApiError(200, "CONTRACT_MISMATCH", "x"))).toBe("fatal");
    expect(classifyFrameError(new ApiError(200, "BAD_JSON", "x"))).toBe("fatal");
    expect(classifyFrameError(new ApiError(429, "FRAME_CHECK_LIMIT", "x"))).toBe("limit");
    expect(classifyFrameError(new ApiError(429, "FRAME_CHECK_IN_FLIGHT", "x"))).toBe("retry");
    expect(classifyFrameError(new ApiError(502, "GROK_UNAVAILABLE", "x"))).toBe("retry");
    expect(classifyFrameError(new ApiError(0, "TIMEOUT", "x"))).toBe("retry");
    expect(classifyFrameError(new Error("snapshot encode failed"))).toBe("retry");
  });

  it("the banner names a plain-language cause", () => {
    expect(verifyCause(run([DEV, ...fail(0, "Request timed out: /api/capture/frame-check")]))).toMatch(/No connection/);
    expect(verifyCause(run([DEV, ...fail(0, "Frame check failed (GROK_UNAVAILABLE)")]))).toMatch(/busy/);
    expect(verifyCause(reduce(run([DEV, { type: "FRAME_REQUESTED", now: 0 }]), { type: "TICK", now: STALL_MS }))).toMatch(/too long/);
  });

  it("a fatal error stops the loop immediately and shows the error state", () => {
    const s = run([DEV, { type: "FRAME_REQUESTED", now: 0 }, { type: "FRAME_ERROR", now: 1, kind: "fatal", message: "does not match" }]);
    expect(s.phase).toBe("cant_verify");
    expect(verifyStatus(s)).toBe("failed");
    expect(lockReason(streetFloodDepth, s)).toBe(CHECK_FAILED_MESSAGE);
    expect(shouldRequestFrame(s, 60_000)).toBe(false);
    expect(isUnlocked(s)).toBe(false);
  });
});

describe("gate: challenge → capture → notes → upload", () => {
  it("TRIGGER only works when ready (shutter and voice share this path)", () => {
    const framing = run([DEV]);
    expect(reduce(framing, { type: "TRIGGER" }).phase).toBe("framing");
    expect(reduce(ready(), { type: "TRIGGER" }).phase).toBe("challenge");
  });

  it("walks the happy path and ignores device noise after capture starts", () => {
    let s = run([{ type: "TRIGGER" }, { type: "BURST_STARTED" }], ready());
    expect(s.phase).toBe("capturing");
    s = reduce(s, { type: "DEVICE", checks: { ...GOOD_DEVICE, steady: false } });
    expect(s.phase).toBe("capturing");
    s = run([{ type: "BURST_DONE" }, { type: "NOTE", id: "water_state", value: "still" }], s);
    expect(s.phase).toBe("notes");
    expect(notesRemaining(streetFloodDepth, s)).toEqual(["debris_present"]);
    s = run([{ type: "SUBMIT" }], s);
    expect(s.phase).toBe("uploading");
    s = reduce(s, { type: "UPLOAD_FAILED", message: "network" });
    expect(s.phase).toBe("notes");
    s = run([{ type: "SUBMIT" }, { type: "UPLOAD_DONE" }], s);
    expect(s.phase).toBe("done");
  });

  it("a failed burst goes back to framing and needs a fresh server pass", () => {
    const s = run([{ type: "TRIGGER" }, { type: "BURST_STARTED" }, { type: "BURST_FAILED", message: "camera" }], ready());
    expect(s.phase).toBe("framing");
    expect(s.greenStreak).toBe(0);
    expect(s.serverGatePassed).toBe(false);
  });

  it("late frame results / errors / stalls during capture do not change the phase", () => {
    let s = run([{ type: "TRIGGER" }, { type: "FRAME_RESULT", result: frame({ blur_ok: false }), now: 5000, gatePassed: false }], ready());
    expect(s.phase).toBe("challenge");
    s = run([{ type: "FRAME_ERROR", now: 5100 }, { type: "FRAME_ERROR", now: 5200 }, { type: "TICK", now: 60_000 }], s);
    expect(s.phase).toBe("challenge");
  });

  it("RETRY starts a fresh capture in the same session, keeping the check budget", () => {
    const s = run([{ type: "TRIGGER" }, { type: "BURST_DONE" }, { type: "NOTE", id: "water_state", value: "fast" }, { type: "RETRY" }], ready());
    expect(s.phase).toBe("framing");
    expect(s.notes).toEqual({});
    expect(s.greenStreak).toBe(0);
    expect(s.serverGatePassed).toBe(false);
    expect(s.attempts).toBe(2);
  });

  it("END from any phase (unsafe / user quit)", () => {
    expect(reduce(ready(), { type: "END", reason: "unsafe" })).toMatchObject({ phase: "ended", endReason: "unsafe" });
  });
});

describe("gate: overlay + voice payloads", () => {
  it("lock reason names the first missing element in protocol order", () => {
    const s = run([DEV, ...check(0, false, frame({ hint: "Tilt down to the waterline" }, ["water_surface"]), 0)]);
    expect(lockReason(streetFloodDepth, s)).toBe("Show the reference object");
    expect(cameraStatus(streetFloodDepth, s)).toEqual({
      missing: ["reference_object", "waterline", "scene_verified"],
      hint: "Tilt down to the waterline",
      ready: false,
    });
  });

  it("all elements green but server not yet passed → 'confirming'", () => {
    const s = run([DEV, ...check(0, false, frame(), 1)]);
    expect(lockReason(streetFloodDepth, s)).toBe("Hold still — confirming");
    const row = checklistRows(streetFloodDepth, s).find((r) => r.id === "verified");
    expect(row).toMatchObject({ ok: false, label: "Scene verified (1/2)" });
  });

  it("device problems outrank element hints; ready says Hold still", () => {
    const s = run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, insideArea: false, distanceM: 420 } }]);
    expect(lockReason(streetFloodDepth, s)).toBe("Move into the bounty area");
    expect(checklistRows(streetFloodDepth, s)[0]?.label).toBe("Outside area (420 m away)");
    const r = ready();
    expect(lockReason(streetFloodDepth, r)).toBeNull();
    expect(cameraStatus(streetFloodDepth, r)).toEqual({ missing: [], hint: "Hold still.", ready: true });
    expect(checklistRows(streetFloodDepth, r).every((row) => row.ok)).toBe(true);
  });

  it("low-confidence 'visible' elements do not count", () => {
    const f = frame();
    f.elements = f.elements.map((e) => (e.id === "waterline" ? { ...e, confidence: 0.3 } : e));
    const s = run([DEV, { type: "FRAME_REQUESTED", now: 0 }, { type: "FRAME_RESULT", result: f, now: 1, gatePassed: false }]);
    expect(s.elements.waterline).toBe(false);
    expect(s.greenStreak).toBe(0);
  });
});
