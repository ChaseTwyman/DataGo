"use client";
import dynamic from "next/dynamic";
import { Loading } from "../page";
import type { HexMapProps } from "./HexMap";

/** MapLibre touches `window` on import, so the map only ever renders on the client. */
export const HexMap = dynamic<HexMapProps>(() => import("./HexMap"), {
  ssr: false,
  loading: () => <Loading label="Loading map…" className="h-full items-center justify-center" />,
});

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
