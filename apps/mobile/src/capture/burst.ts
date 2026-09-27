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
 * Floor on the spacing between challenge frames. Protocols often ask for ~700 ms, which gave people
 * 1.4 s to "step closer" — too short to show any movement, so real captures failed the challenge.
 */
export const MIN_CHALLENGE_INTERVAL_MS = 1200;

export function burstIntervalMs(protocolIntervalMs: number): number {
  return Math.max(protocolIntervalMs, MIN_CHALLENGE_INTERVAL_MS);
}

/** Long edge (px) of uploaded frames: verification sees ≤1536 px; full 12 MP JPEGs made upload ~20 s. */
export const UPLOAD_LONG_EDGE = 2560;

/** Resize target keeping aspect ratio, or null when the frame is already small enough. */
export function uploadResize(width: number, height: number, longEdge = UPLOAD_LONG_EDGE): { width: number } | { height: number } | null {
  if (!(width > 0 && height > 0) || Math.max(width, height) <= longEdge) return null;
  return width >= height ? { width: longEdge } : { height: longEdge };
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
