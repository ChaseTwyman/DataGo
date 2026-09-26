"use client";
import { useEffect, useState } from "react";
import { cn, formatTime } from "@/lib/client/cn";
import { relativeLabel } from "./format";

/** Relative timestamp with the exact local time on hover (and in `dateTime` for assistive tech). */
export function RelativeTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return <span className={className}>—</span>;
  const exact = new Date(iso);
  if (Number.isNaN(exact.getTime())) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} title={exact.toLocaleString()} className={cn("tabular-nums", className)} suppressHydrationWarning>
      {relativeLabel(iso, now)}
    </time>
  );
}

/** Exact short time ("Sep 26, 14:05") with the relative time on hover. */
export function ExactTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} title={relativeLabel(iso, Date.now())} className={cn("tabular-nums", className)} suppressHydrationWarning>
      {formatTime(iso)}
    </time>
  );
}
