import { streetFloodDepth, type FrameCheckResult } from "@groundtruth/shared";
import { describe, expect, it } from "vitest";
import {
  cameraStatus,
  checklistRows,
  DEGRADE_AFTER_MS,
  gateReducer,
  initialGate,
  isUnlocked,
  lockReason,
  notesRemaining,
  shouldRequestFrame,
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

const green = (now: number): GateEvent[] => [
  { type: "FRAME_REQUESTED", now },
  { type: "FRAME_RESULT", result: frame(), now: now + 500 },
];

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

describe("gate: unlock rule", () => {
  it("one green frame is not enough; two consecutive unlock", () => {
    const one = run([{ type: "DEVICE", checks: GOOD_DEVICE }, ...green(0)]);
    expect(one.phase).toBe("framing");
    expect(one.greenStreak).toBe(1);
    const two = run(green(1200), one);
    expect(two.phase).toBe("ready");
    expect(isUnlocked(two)).toBe(true);
  });

  it("any red frame resets the streak", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, ...green(0)]);
    s = run([{ type: "FRAME_REQUESTED", now: 1200 }, { type: "FRAME_RESULT", result: frame({}, ["water_surface"]), now: 1700 }], s);
    expect(s.greenStreak).toBe(0);
    s = run(green(2400), s);
    expect(s.phase).toBe("framing");
    s = run(green(3600), s);
    expect(s.phase).toBe("ready");
  });

  it("a red frame after unlocking re-locks the shutter", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, ...green(0), ...green(1200)]);
    expect(s.phase).toBe("ready");
    s = run([{ type: "FRAME_REQUESTED", now: 2400 }, { type: "FRAME_RESULT", result: frame({ blur_ok: false }), now: 2900 }], s);
    expect(s.phase).toBe("framing");
  });

  it("screen/print suspicion blocks unlock even if everything else is green, and is flagged", () => {
    const screen = frame({ suspected_screen_or_print: { value: true, confidence: 0.9 } });
    const s = run([
      { type: "DEVICE", checks: GOOD_DEVICE },
      { type: "FRAME_REQUESTED", now: 0 },
      { type: "FRAME_RESULT", result: screen, now: 400 },
      { type: "FRAME_REQUESTED", now: 1200 },
      { type: "FRAME_RESULT", result: screen, now: 1600 },
    ]);
    expect(s.phase).toBe("framing");
    expect(s.screenSuspected).toBe(true);
    expect(lockReason(streetFloodDepth, s)).toMatch(/screen or print/);
    expect(checklistRows(streetFloodDepth, s).find((r) => r.id === "screen")?.ok).toBe(false);
    expect(cameraStatus(streetFloodDepth, s).missing).toContain("real_scene");
  });

  it("losing level or steadiness re-locks a ready shutter", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, ...green(0), ...green(1200)]);
    s = reduce(s, { type: "DEVICE", checks: { ...GOOD_DEVICE, steady: false } });
    expect(s.phase).toBe("framing");
    expect(lockReason(streetFloodDepth, s)).toBe("Hold steady");
    s = reduce(s, { type: "DEVICE", checks: GOOD_DEVICE });
    expect(s.phase).toBe("ready"); // streak survives a brief wobble; frames were still green
  });
});

describe("gate: frame loop guard", () => {
  it("requests only when device checks pass, nothing in flight, and ≥ 1.2 s since last", () => {
    let s = run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, tiltOk: false } }]);
    expect(shouldRequestFrame(s, 0)).toBe(false);
    s = reduce(s, { type: "DEVICE", checks: GOOD_DEVICE });
    expect(shouldRequestFrame(s, 0)).toBe(true);
    s = reduce(s, { type: "FRAME_REQUESTED", now: 0 });
    expect(shouldRequestFrame(s, 5000)).toBe(false); // in flight
    s = reduce(s, { type: "FRAME_RESULT", result: frame(), now: 600 });
    expect(shouldRequestFrame(s, 1100)).toBe(false);
    expect(shouldRequestFrame(s, 1200)).toBe(true);
  });

  it("stops at the per-session frame-check limit", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }]);
    s = reduce(s, { type: "FRAME_REQUESTED", now: 0 });
    s = reduce(s, { type: "FRAME_RESULT", result: frame(), now: 100, checksRemaining: 0 });
    expect(shouldRequestFrame(s, 5000)).toBe(false);
  });
});

describe("gate: degraded mode", () => {
  it("errors for 10 s → device checks only, unlocked, degraded=true", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, { type: "FRAME_ERROR", now: 0 }]);
    expect(s.degraded).toBe(false);
    s = reduce(s, { type: "FRAME_ERROR", now: 5000 });
    expect(s.degraded).toBe(false);
    s = reduce(s, { type: "FRAME_ERROR", now: DEGRADE_AFTER_MS });
    expect(s.degraded).toBe(true);
    expect(s.phase).toBe("ready");
    expect(shouldRequestFrame(s, 20_000)).toBe(false);
    expect(checklistRows(streetFloodDepth, s).filter((r) => r.kind === "element").every((r) => r.ok)).toBe(true);
  });

  it("a success in between clears the trouble clock", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, { type: "FRAME_ERROR", now: 0 }]);
    s = run([{ type: "FRAME_REQUESTED", now: 6000 }, { type: "FRAME_RESULT", result: frame(), now: 6500 }], s);
    s = reduce(s, { type: "FRAME_ERROR", now: 11_000 });
    expect(s.degraded).toBe(false);
  });

  it("a request stuck in flight for 10 s degrades via TICK", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, { type: "FRAME_REQUESTED", now: 0 }]);
    s = reduce(s, { type: "TICK", now: 9_999 });
    expect(s.degraded).toBe(false);
    s = reduce(s, { type: "TICK", now: 10_000 });
    expect(s.degraded).toBe(true);
    expect(s.phase).toBe("ready");
  });

  it("degraded mode never unlocks over a known screen/print flag", () => {
    const screen = frame({ suspected_screen_or_print: { value: true, confidence: 0.9 } });
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, { type: "FRAME_REQUESTED", now: 0 }, { type: "FRAME_RESULT", result: screen, now: 100 }]);
    s = run([{ type: "FRAME_ERROR", now: 200 }, { type: "FRAME_ERROR", now: 10_200 }], s);
    expect(s.degraded).toBe(true);
    expect(isUnlocked(s)).toBe(false);
    expect(s.phase).toBe("framing");
    expect(lockReason(streetFloodDepth, s)).toMatch(/screen or print/);
  });

  it("degraded is frozen once the capture starts", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, ...green(0), ...green(1200), { type: "FRAME_REQUESTED", now: 2400 }, { type: "TRIGGER" }]);
    s = run([{ type: "TICK", now: 20_000 }], s);
    expect(s.phase).toBe("challenge");
    expect(s.degraded).toBe(false);
  });

  it("degraded still requires the device checks", () => {
    let s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, { type: "FRAME_ERROR", now: 0 }, { type: "FRAME_ERROR", now: 10_000 }]);
    s = reduce(s, { type: "DEVICE", checks: { ...GOOD_DEVICE, tiltOk: false } });
    expect(s.phase).toBe("framing");
  });
});

describe("gate: challenge → capture → notes → upload", () => {
  const ready = () => run([{ type: "DEVICE", checks: GOOD_DEVICE }, ...green(0), ...green(1200)]);

  it("TRIGGER only works when ready (shutter and voice share this path)", () => {
    const framing = run([{ type: "DEVICE", checks: GOOD_DEVICE }]);
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

  it("a failed burst goes back to framing with the streak reset", () => {
    const s = run([{ type: "TRIGGER" }, { type: "BURST_STARTED" }, { type: "BURST_FAILED", message: "camera" }], ready());
    expect(s.phase).toBe("framing");
    expect(s.greenStreak).toBe(0);
  });

  it("late frame results during capture do not change the phase", () => {
    const s = run([{ type: "TRIGGER" }, { type: "FRAME_RESULT", result: frame({ blur_ok: false }), now: 5000 }], ready());
    expect(s.phase).toBe("challenge");
  });

  it("RETRY starts a fresh capture in the same session", () => {
    const s = run([{ type: "TRIGGER" }, { type: "BURST_DONE" }, { type: "NOTE", id: "water_state", value: "fast" }, { type: "RETRY" }], ready());
    expect(s.phase).toBe("framing");
    expect(s.notes).toEqual({});
    expect(s.greenStreak).toBe(0);
  });

  it("END from any phase (unsafe / user quit)", () => {
    expect(reduce(ready(), { type: "END", reason: "unsafe" })).toMatchObject({ phase: "ended", endReason: "unsafe" });
  });
});

describe("gate: overlay + voice payloads", () => {
  it("lock reason names the first missing element in protocol order", () => {
    const s = run([
      { type: "DEVICE", checks: GOOD_DEVICE },
      { type: "FRAME_REQUESTED", now: 0 },
      { type: "FRAME_RESULT", result: frame({ hint: "Tilt down to the waterline" }, ["water_surface"]), now: 500 },
    ]);
    expect(lockReason(streetFloodDepth, s)).toBe("Show the reference object");
    expect(cameraStatus(streetFloodDepth, s)).toEqual({
      missing: ["reference_object", "waterline"],
      hint: "Tilt down to the waterline",
      ready: false,
    });
  });

  it("device problems outrank element hints; ready says Hold still", () => {
    const s = run([{ type: "DEVICE", checks: { ...GOOD_DEVICE, insideArea: false, distanceM: 420 } }]);
    expect(lockReason(streetFloodDepth, s)).toBe("Move into the bounty area");
    expect(checklistRows(streetFloodDepth, s)[0]?.label).toBe("Outside area (420 m away)");
    const r = run([{ type: "DEVICE", checks: GOOD_DEVICE }, ...green(0), ...green(1200)]);
    expect(lockReason(streetFloodDepth, r)).toBeNull();
    expect(cameraStatus(streetFloodDepth, r)).toEqual({ missing: [], hint: "Hold still.", ready: true });
  });

  it("low-confidence 'visible' elements do not count", () => {
    const f = frame();
    f.elements = f.elements.map((e) => (e.id === "waterline" ? { ...e, confidence: 0.3 } : e));
    const s = run([{ type: "DEVICE", checks: GOOD_DEVICE }, { type: "FRAME_REQUESTED", now: 0 }, { type: "FRAME_RESULT", result: f, now: 1 }]);
    expect(s.elements.waterline).toBe(false);
    expect(s.greenStreak).toBe(0);
  });
});
