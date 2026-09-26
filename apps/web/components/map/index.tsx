"use client";
import { catchError, type ErrorInfo } from "next/error";
import dynamic from "next/dynamic";
import { Loading } from "../page";
import type { HexMapProps } from "./HexMap";

/** MapLibre touches `window` on import, so the map only ever renders on the client. */
const HexMapInner = dynamic<HexMapProps>(() => import("./HexMap"), {
  ssr: false,
  loading: () => <Loading label="Loading map…" className="h-full items-center justify-center" />,
});

/**
 * A map that can't start (no WebGL, blocked worker, failed chunk load) must not take the page down:
 * the boundary shows a static notice in the map's box and the rest of the page keeps working.
 */
const MapBoundary = catchError(function MapFallback(props: { className?: string }, { retry }: ErrorInfo) {
  return (
    <div className={`relative h-full w-full bg-muted ${props.className ?? ""}`} role="status">
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="max-w-xs rounded-lg border bg-card p-4 text-center text-sm shadow-sm">
          <div className="font-medium">Map unavailable</div>
          <p className="mt-1 text-muted-foreground">This browser couldn&apos;t start the map. Everything else on this page still works.</p>
          <button type="button" onClick={() => retry()} className="mt-3 cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline">
            Try again
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
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card/95 px-3 py-2 text-[11px] shadow-sm backdrop-blur">
      <span className="font-medium text-muted-foreground">Fill vs target</span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-24 rounded-full bg-gradient-to-r from-[#ef4444] via-[#f59e0b] to-[#10b981]" />
        <span className="text-muted-foreground">0% → 100%</span>
      </span>
      {showPaused ? (
        <span className="flex items-center gap-1">
          <span
            className="size-3 rounded-sm border border-gray-600 border-dashed"
            style={{ background: "repeating-linear-gradient(45deg,#9ca3af 0 2px,transparent 2px 5px)" }}
          />
          Paused (hazard)
        </span>
      ) : null}
    </div>
  );
}
