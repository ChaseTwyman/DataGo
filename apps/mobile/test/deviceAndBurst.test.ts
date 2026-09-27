import { describe, expect, it } from "vitest";
import { burstIntervalMs, MIN_CHALLENGE_INTERVAL_MS, runBurst, sensorSnapshot, toMediaItems, UPLOAD_LONG_EDGE, uploadResize, type CapturedFrame } from "../src/capture/burst";
import { rollDeviationDeg, rotationMagnitude, SteadinessTracker, tiltOk } from "../src/capture/deviceMath";

const G = 9.81;
const rad = (d: number) => (d * Math.PI) / 180;

describe("rollDeviationDeg", () => {
  it("is ~0 for an upright portrait phone and for a level landscape phone", () => {
    expect(rollDeviationDeg(0, -G, 0, "portrait")).toBeCloseTo(0);
    expect(rollDeviationDeg(G, 0, 0, "landscape")).toBeCloseTo(0);
    expect(rollDeviationDeg(-G, 0, 0, "landscape")).toBeCloseTo(0);
  });

  it("measures roll, not pitch: pointing down at the water is still level", () => {
    // landscape, camera pitched 50° down: gravity splits between x and z
    expect(rollDeviationDeg(G * Math.cos(rad(50)), 0, -G * Math.sin(rad(50)), "landscape")).toBeCloseTo(0);
  });

  it("reports a 20° roll in landscape", () => {
    const d = rollDeviationDeg(G * Math.cos(rad(20)), -G * Math.sin(rad(20)), 0, "landscape");
    expect(d).toBeCloseTo(20, 5);
    expect(tiltOk(d, 15)).toBe(false);
    expect(tiltOk(rollDeviationDeg(G * Math.cos(rad(10)), G * Math.sin(rad(10)), 0, "landscape"), 15)).toBe(true);
  });

  it("portrait phone fails a landscape protocol; 'any' accepts both", () => {
    expect(rollDeviationDeg(0, -G, 0, "landscape")).toBeCloseTo(90);
    expect(rollDeviationDeg(0, -G, 0, "any")).toBeCloseTo(0);
  });

  it("is null (and allowed) when the phone is nearly flat", () => {
    expect(rollDeviationDeg(0.5, 0.5, -G, "landscape")).toBeNull();
    expect(tiltOk(null, 15)).toBe(true);
  });
});

describe("SteadinessTracker", () => {
  it("needs 500 ms of low rotation, and any spike resets it", () => {
    const t = new SteadinessTracker(25, 500);
    expect(t.update(5, 0)).toBe(false);
    expect(t.update(5, 499)).toBe(false);
    expect(t.update(5, 500)).toBe(true);
    expect(t.update(80, 600)).toBe(false);
    expect(t.update(5, 700)).toBe(false);
    expect(t.update(5, 1200)).toBe(true);
    expect(t.update(null, 1300)).toBe(false);
  });

  it("rotationMagnitude combines the three axes", () => {
    expect(rotationMagnitude({ alpha: 3, beta: 4, gamma: 0 })).toBe(5);
    expect(rotationMagnitude(null)).toBeNull();
  });
});

describe("runBurst", () => {
  const mk = (i: number, t: number): CapturedFrame => ({ uri: `file://${i}.jpg`, width: 4032, height: 3024, capturedAt: new Date(t).toISOString(), exif: {} });

  it("captures `frames` photos on a fixed schedule from t0", async () => {
    let t = 1000;
    const shots: number[] = [];
    const frames = await runBurst(3, 600, {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      capture: async () => {
        shots.push(t);
        t += 150; // capture latency
        return mk(shots.length, t);
      },
    });
    expect(frames).toHaveLength(3);
    expect(shots).toEqual([1000, 1600, 2200]);
  });

  it("does not add extra delay when a capture overruns the interval", async () => {
    let t = 0;
    const shots: number[] = [];
    await runBurst(3, 600, {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      capture: async () => {
        shots.push(t);
        t += 900;
        return mk(shots.length, t);
      },
    });
    expect(shots).toEqual([0, 900, 1800]);
  });

  it("builds media items with the upload paths and a rounded sensor snapshot", () => {
    const items = toMediaItems([mk(0, 0), mk(1, 600)], ["observations/u/s/0.jpg", "observations/u/s/1.jpg"]);
    expect(items[1]).toMatchObject({ path: "observations/u/s/1.jpg", width: 4032, height: 3024 });
    expect(sensorSnapshot(3.14159, 12.345, true, null)).toEqual({ tilt_deg: 3.1, rotation_rate: 12.3, heading_deg: null, steady: true });
  });
});

describe("burstIntervalMs", () => {
  it("stretches short protocol intervals so a motion challenge is physically doable", () => {
    expect(burstIntervalMs(700)).toBe(MIN_CHALLENGE_INTERVAL_MS);
    expect(2 * burstIntervalMs(700)).toBeGreaterThanOrEqual(2400); // 3 frames span ≥ 2.4 s
  });
  it("keeps longer protocol intervals", () => {
    expect(burstIntervalMs(2000)).toBe(2000);
  });
});

describe("uploadResize", () => {
  it("shrinks a 12 MP landscape frame to the upload long edge", () => {
    expect(uploadResize(4032, 3024)).toEqual({ width: UPLOAD_LONG_EDGE });
  });
  it("uses height for portrait frames", () => {
    expect(uploadResize(3024, 4032)).toEqual({ height: UPLOAD_LONG_EDGE });
  });
  it("leaves small or unknown-size frames alone", () => {
    expect(uploadResize(1920, 1080)).toBeNull();
    expect(uploadResize(0, 0)).toBeNull();
  });
});
