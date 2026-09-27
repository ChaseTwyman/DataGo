"use client";
import { catchError, type ErrorInfo } from "next/error";
import dynamic from "next/dynamic";
import { MapPanel } from "../ds/MapFrame";
import type { HexMapProps } from "./HexMap";

/** MapLibre touches `window` on import, so the map only ever renders on the client. */
const HexMapInner = dynamic<HexMapProps>(() => import("./HexMap"), {
  ssr: false,
  loading: () => (
    <div data-theme="dark" className="caps flex h-full w-full items-center justify-center bg-[#0c0c0c] text-[10px] text-muted-foreground" role="status">
      <span className="gt-skeleton mr-2 inline-block size-1.5 rounded-full bg-primary" aria-hidden />
      Loading map…
    </div>
  ),
});

/**
 * A map that can't start (no WebGL, blocked worker, failed chunk load) must not take the page down:
 * the boundary shows a static notice in the map's box and the rest of the page keeps working.
 */
const MapBoundary = catchError(function MapFallback(props: { className?: string }, { retry }: ErrorInfo) {
  return (
    <div data-theme="dark" className={`relative h-full w-full bg-[#0c0c0c] text-foreground ${props.className ?? ""}`} role="status">
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="max-w-xs border-l-2 border-warning py-1 pl-4 text-sm">
          <div className="caps text-xs font-semibold">Map unavailable</div>
          <p className="mt-1 text-muted-foreground">This browser couldn&apos;t start the map. Everything else on this page still works.</p>
          <button type="button" onClick={() => retry()} className="caps mt-3 cursor-pointer text-[11px] font-semibold text-primary hover:text-foreground">
            Try again →
          </button>
        </div>
      </div>
    </div>
  );
});

export function HexMap(props: HexMapProps) {
  return (
    <MapBoundary className={props.className}>
      <HexMapInner {...props} />
    </MapBoundary>
  );
}

export type { HexMapProps, MapPoint } from "./HexMap";

export function MapLegend({ showPaused = true }: { showPaused?: boolean }) {
  return (
    <MapPanel className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-[11px]">
      <span className="caps text-[10px] text-muted-foreground">Fill vs target</span>
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-24 bg-gradient-to-r from-[#ef4444] via-[#f59e0b] to-[#10b981]" aria-hidden />
        <span className="text-muted-foreground tabular-nums">0% → 100%</span>
      </span>
      {showPaused ? (
        <span className="flex items-center gap-1.5">
          <span
            className="size-3 border border-dashed border-muted-foreground"
            style={{ background: "repeating-linear-gradient(45deg,#8a8f98 0 2px,transparent 2px 5px)" }}
            aria-hidden
          />
          Paused (hazard)
        </span>
      ) : null}
    </MapPanel>
  );
}
