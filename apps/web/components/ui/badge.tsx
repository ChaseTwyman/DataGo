import type { HTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";
import type { Tone } from "@/lib/client/checkFormat";

/** Status pill tones: coloured text + a tinted hairline on the dark panel (all ≥ 4.5:1, see tokens). */
export const TONE_CLASSES: Record<Tone, string> = {
  success: "text-success border-success/40 bg-success/[0.07]",
  warning: "text-warning border-warning/45 bg-warning/[0.07]",
  danger: "text-destructive border-destructive/45 bg-destructive/[0.07]",
  info: "text-info border-info/40 bg-info/[0.07]",
  progress: "text-primary border-primary/40 bg-primary/[0.07]",
  muted: "text-muted-foreground border-border bg-transparent",
};

export function Badge({ tone = "muted", className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "caps inline-flex h-5 items-center gap-1 rounded-[2px] border px-1.5 text-[10px] font-semibold tracking-[0.1em] whitespace-nowrap [&_svg]:size-3 [&_svg]:stroke-[2]",
        TONE_CLASSES[tone],
        className,
      )}
      {...p}
    />
  );
}
