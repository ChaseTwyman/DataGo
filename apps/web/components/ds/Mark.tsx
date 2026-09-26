import { useId } from "react";
import { cn } from "@/lib/client/cn";

/**
 * The GroundTruth mark: a hexagon (one H3 cell) with the ground line through it and the half below
 * the line filled. Same geometry as apps/mobile/assets/mark.svg. Inherits `currentColor`.
 */
export function Mark({ className, title }: { className?: string; title?: string }) {
  const clip = useId();
  return (
    <svg
      viewBox="150 190 724 644"
      className={cn("size-6", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="556" width="1024" height="468" />
        </clipPath>
      </defs>
      <polygon
        points="832,512 672,789.1 352,789.1 192,512 352,234.9 672,234.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="48"
        strokeLinejoin="miter"
      />
      <polygon points="832,512 672,789.1 352,789.1 192,512 352,234.9 672,234.9" fill="currentColor" clipPath={`url(#${clip})`} />
      <rect x="150" y="494" width="724" height="36" fill="currentColor" />
    </svg>
  );
}

/** Mark + wordmark, as on /data. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark className="size-6" />
      <span className="caps text-sm font-semibold tracking-[0.32em]">GroundTruth</span>
    </span>
  );
}
