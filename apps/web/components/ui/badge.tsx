import type { HTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";
import type { Tone } from "@/lib/client/checkFormat";

export const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-800 border-red-200",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  progress: "bg-indigo-50 text-indigo-800 border-indigo-200",
  muted: "bg-zinc-50 text-zinc-600 border-zinc-200",
};

export function Badge({ tone = "muted", className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3",
        TONE_CLASSES[tone],
        className,
      )}
      {...p}
    />
  );
}
