import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/client/cn";

/**
 * Map chrome. The basemap is OpenFreeMap "dark" (components/map/HexMap.tsx); overlays sit on it as
 * translucent black panels with a hairline, like instrument readouts over a feed.
 */
export function MapFrame({ className, children, label }: { className?: string; children: ReactNode; label?: ReactNode }) {
  return (
    <div data-theme="dark" className={cn("relative overflow-hidden border bg-[#0c0c0c] text-foreground", className)}>
      {children}
      {label ? (
        <div className="caps pointer-events-none absolute top-3 left-3 border bg-black/75 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
          {label}
        </div>
      ) : null}
    </div>
  );
}

/** Translucent panel for content drawn over a map. */
export function MapPanel({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div data-theme="dark" className={cn("rounded-sm border bg-black/80 text-foreground backdrop-blur-sm", className)} {...p} />;
}
