/**
 * The spacing the verification model is told the burst frames were taken at. The phone may space
 * frames wider than the protocol's `frame_interval_ms` (from 2026-09-27 it uses
 * max(frame_interval_ms, 1200 ms) so there is time to perform the challenge); telling the model
 * "700 ms" for a 2.4 s burst would skew what motion it expects. So: median gap between consecutive
 * media[].captured_at, clamped to [MIN, MAX]. Any missing, unparseable, or non-increasing timestamp
 * means we can't trust the series → the protocol's value.
 */
export const BURST_INTERVAL_MIN_MS = 100;
export const BURST_INTERVAL_MAX_MS = 5000;

export function burstIntervalMs(capturedAt: readonly (string | null | undefined)[], fallbackMs: number): number {
  if (capturedAt.length < 2) return fallbackMs;
  const t: number[] = [];
  for (const s of capturedAt) {
    const v = typeof s === "string" ? Date.parse(s) : NaN;
    if (!Number.isFinite(v)) return fallbackMs;
    t.push(v);
  }
  const gaps = t.slice(1).map((v, i) => v - t[i]!);
  if (gaps.some((g) => g <= 0)) return fallbackMs;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.round(Math.min(BURST_INTERVAL_MAX_MS, Math.max(BURST_INTERVAL_MIN_MS, median)));
}
