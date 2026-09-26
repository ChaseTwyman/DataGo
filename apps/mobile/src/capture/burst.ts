/**
 * Challenge burst (BUILD_PROMPT §M2): `frames` photos at `frame_interval_ms` while the user performs
 * the random challenge. Scheduling and metadata assembly are pure; the camera, clock, and sleep are
 * injected so the timing is unit-tested.
 */
import type { MediaItem, SensorSnapshot } from "@groundtruth/shared";

export interface CapturedFrame {
  uri: string;
  width: number;
  height: number;
  capturedAt: string;
  /** What the camera library exposes about the frame. Full EXIF stays embedded in the JPEG bytes. */
  exif: Record<string, unknown>;
}

export interface BurstDeps {
  capture: () => Promise<CapturedFrame>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  onFrame?: (index: number, frame: CapturedFrame) => void;
}

/**
 * Frame i is scheduled at t0 + i × interval; if a capture overruns, the next one fires immediately
 * rather than drifting the whole burst.
 */
export async function runBurst(frames: number, intervalMs: number, deps: BurstDeps): Promise<CapturedFrame[]> {
  const out: CapturedFrame[] = [];
  const t0 = deps.now();
  for (let i = 0; i < frames; i++) {
    const due = t0 + i * intervalMs;
    const wait = due - deps.now();
    if (wait > 0) await deps.sleep(wait);
    const f = await deps.capture();
    out.push(f);
    deps.onFrame?.(i, f);
  }
  return out;
}

/** Countdown before the burst so the user hears/reads the challenge first. */
export const CHALLENGE_LEAD_MS = 1800;

export function toMediaItems(frames: CapturedFrame[], paths: string[]): MediaItem[] {
  return frames.map((f, i) => ({
    path: paths[i] ?? "",
    width: f.width > 0 ? Math.round(f.width) : undefined,
    height: f.height > 0 ? Math.round(f.height) : undefined,
    captured_at: f.capturedAt,
    exif: f.exif,
  }));
}

export function sensorSnapshot(tiltDeg: number | null, rotationRate: number | null, steady: boolean | null, headingDeg: number | null): SensorSnapshot {
  return {
    tilt_deg: tiltDeg === null ? null : Math.round(tiltDeg * 10) / 10,
    rotation_rate: rotationRate === null ? null : Math.round(rotationRate * 10) / 10,
    heading_deg: headingDeg,
    steady,
  };
}
