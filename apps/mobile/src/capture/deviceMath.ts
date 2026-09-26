/**
 * Pure sensor math behind useDeviceChecks (unit-tested; no expo imports).
 *
 * Tilt = roll: how far the horizon is rotated in the picture. Pitch (pointing the camera down at
 * the waterline) is allowed, so tilt is measured only from the gravity vector's direction within
 * the screen plane (x, y), relative to the axis the protocol's orientation expects.
 */

export type Orientation = "landscape" | "portrait" | "any";

const DEG = 180 / Math.PI;

/**
 * Degrees the horizon deviates from level, or null when the phone is near flat (gravity mostly on
 * z) and roll is undefined. Units of g don't matter (ratios only).
 */
export function rollDeviationDeg(gx: number, gy: number, gz: number, orientation: Orientation): number | null {
  const inPlane = Math.hypot(gx, gy);
  const total = Math.hypot(gx, gy, gz);
  if (total === 0 || inPlane / total < 0.35) return null; // within ~20° of flat
  // Angle of gravity within the screen plane: 0 = portrait upright (gravity toward -y).
  const angle = Math.atan2(gx, -gy) * DEG; // (-180, 180]
  const dist = (target: number) => {
    const d = Math.abs(((angle - target + 540) % 360) - 180);
    return d;
  };
  const portrait = Math.min(dist(0), dist(180));
  const landscape = Math.min(dist(90), dist(-90));
  if (orientation === "portrait") return portrait;
  if (orientation === "landscape") return landscape;
  return Math.min(portrait, landscape);
}

export function tiltOk(deviation: number | null, maxTiltDeg: number): boolean {
  // Near-flat: roll is meaningless; don't block the user on it.
  return deviation === null || deviation <= maxTiltDeg;
}

/** Rotation rate magnitude (deg/s) from DeviceMotion rotationRate {alpha, beta, gamma}. */
export function rotationMagnitude(r: { alpha: number; beta: number; gamma: number } | null | undefined): number | null {
  if (!r) return null;
  return Math.hypot(r.alpha, r.beta, r.gamma);
}

/** Steady = rotation rate below threshold continuously for `holdMs` (PRD §9.1: 500 ms). */
export class SteadinessTracker {
  private calmSince: number | null = null;
  constructor(
    private readonly thresholdDegPerSec = 25,
    private readonly holdMs = 500,
  ) {}
  update(rate: number | null, now: number): boolean {
    if (rate === null || rate > this.thresholdDegPerSec) {
      this.calmSince = null;
      return false;
    }
    if (this.calmSince === null) this.calmSince = now;
    return now - this.calmSince >= this.holdMs;
  }
  reset(): void {
    this.calmSince = null;
  }
}
