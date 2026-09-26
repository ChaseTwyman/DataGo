"use client";
import { useMemo } from "react";
import { cellToPolygon } from "@groundtruth/shared";

/**
 * Observation hexes as a flat SVG (no basemap): each observed H3 cell, filled by row count.
 * Deliberately not the dashboard's MapLibre map — that one encodes price/fill-vs-target and a light
 * basemap; here we only need "where the data is", on black, with no tile requests.
 */
export function HexCoverage({ cells, accent, className }: { cells: { h3_cell: string; rows: number }[]; accent: string; className?: string }) {
  const shapes = useMemo(() => {
    if (cells.length === 0) return null;
    // A malformed cell id must not take the page down: skip it.
    const polys = cells.flatMap((c) => {
      try {
        return [{ ...c, ring: cellToPolygon(c.h3_cell).coordinates[0] ?? [] }];
      } catch {
        return [];
      }
    });
    if (polys.length === 0) return null;
    const all = polys.flatMap((p) => p.ring);
    const lat0 = all.reduce((a, [, lat]) => a + lat, 0) / all.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = all.map(([lng]) => lng * k);
    const ys = all.map(([, lat]) => -lat);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(...xs) - minX || 1e-3;
    const h = Math.max(...ys) - minY || 1e-3;
    const size = 1000;
    const scale = (size * 0.86) / Math.max(w, h);
    const offX = (size - w * scale) / 2;
    const offY = (size - h * scale) / 2;
    // ≥ 1 so an all-zero set (Ask the data: cells under target) shades faintly instead of NaN.
    const max = Math.max(1, ...cells.map((c) => c.rows));
    return polys.map((p) => ({
      cell: p.h3_cell,
      rows: p.rows,
      opacity: 0.18 + 0.72 * (p.rows / max),
      d:
        p.ring
          .map(([lng, lat], i) => `${i ? "L" : "M"}${(offX + (lng * k - minX) * scale).toFixed(1)},${(offY + (-lat - minY) * scale).toFixed(1)}`)
          .join("") + "Z",
    }));
  }, [cells]);

  if (!shapes) {
    return (
      <div className={`flex items-center justify-center text-[11px] tracking-[0.25em] text-white/55 uppercase ${className ?? ""}`}>
        No observations yet
      </div>
    );
  }
  return (
    <svg viewBox="0 0 1000 1000" className={className} role="img" aria-label={`${shapes.length} H3 cells with observations`}>
      <defs>
        <pattern id="gt-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M50 0H0V50" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1000" height="1000" fill="url(#gt-grid)" />
      {shapes.map((s) => (
        <path key={s.cell} d={s.d} fill={accent} fillOpacity={s.opacity} stroke="rgba(255,255,255,0.55)" strokeWidth={1.5}>
          <title>{`${s.cell} · ${s.rows} observation${s.rows === 1 ? "" : "s"}`}</title>
        </path>
      ))}
    </svg>
  );
}
