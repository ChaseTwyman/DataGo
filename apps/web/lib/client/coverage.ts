/**
 * Coverage map styling: turns API cell prices into GeoJSON features whose properties carry the
 * already-computed fill color and label, so the MapLibre layers stay dumb (`["get", "color"]`).
 */
import { cellsToFeatureCollection, formatCents, formatSurge, type CellFeatureCollection, type CellPrice } from "@groundtruth/shared";

export interface CoverageProps extends Record<string, unknown> {
  ratio: number;
  color: string;
  price_label: string;
  surge_label: string;
  accepted: number;
  target: number;
  paused: boolean;
  paused_reason: string | null;
}

/** Stops for the fill ramp: empty (needs data) → half → full. */
export const FILL_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, "#ef4444"],
  [0.5, "#f59e0b"],
  [1, "#10b981"],
];

export const PAUSED_COLOR = "#9ca3af";

export function fillRatio(accepted: number, target: number): number {
  if (!(target > 0)) return 1;
  return Math.min(1, Math.max(0, accepted / target));
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

function parseHex(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** Linear interpolation across FILL_STOPS. Ratio is clamped to 0..1. */
export function fillColor(ratio: number): string {
  const r = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  for (let i = 1; i < FILL_STOPS.length; i++) {
    const [hiT, hiC] = FILL_STOPS[i] as readonly [number, string];
    const [loT, loC] = FILL_STOPS[i - 1] as readonly [number, string];
    if (r <= hiT) {
      const t = hiT === loT ? 0 : (r - loT) / (hiT - loT);
      const a = parseHex(loC);
      const b = parseHex(hiC);
      return `#${hex2(a[0] + (b[0] - a[0]) * t)}${hex2(a[1] + (b[1] - a[1]) * t)}${hex2(a[2] + (b[2] - a[2]) * t)}`;
    }
  }
  return (FILL_STOPS[FILL_STOPS.length - 1] as readonly [number, string])[1];
}

export function coverageFeatures(cells: CellPrice[]): CellFeatureCollection<CoverageProps> {
  const byCell = new Map(cells.map((c) => [c.cell, c]));
  return cellsToFeatureCollection<CoverageProps>(
    cells.map((c) => c.cell),
    (cell) => {
      const c = byCell.get(cell) as CellPrice;
      const ratio = fillRatio(c.accepted, c.target);
      return {
        ratio,
        color: c.paused ? PAUSED_COLOR : fillColor(ratio),
        price_label: c.paused ? "PAUSED" : formatCents(c.price_cents),
        surge_label: c.paused ? "" : formatSurge(c.surge),
        accepted: c.accepted,
        target: c.target,
        paused: c.paused,
        paused_reason: c.paused_reason,
      };
    },
  );
}

export interface CoverageSummary {
  cells: number;
  accepted: number;
  target: number;
  ratio: number;
  paused: number;
  maxSurge: number;
  pausedReasons: string[];
}

export function summarizeCoverage(cells: CellPrice[]): CoverageSummary {
  const accepted = cells.reduce((s, c) => s + Math.min(c.accepted, c.target), 0);
  const target = cells.reduce((s, c) => s + c.target, 0);
  const paused = cells.filter((c) => c.paused);
  return {
    cells: cells.length,
    accepted,
    target,
    ratio: target > 0 ? accepted / target : 0,
    paused: paused.length,
    maxSurge: cells.filter((c) => !c.paused).reduce((m, c) => Math.max(m, c.surge), 0),
    pausedReasons: [...new Set(paused.map((c) => c.paused_reason ?? "Hazard warning"))],
  };
}
