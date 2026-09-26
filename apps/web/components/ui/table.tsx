import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";

/**
 * Dense data table: caps header (sticky inside a scroll box), hairline rows, no zebra, tabular
 * numerals. Right-align numeric columns with `className="text-right"` on TH and TD.
 */
export const Table = ({ className, containerClassName, ...p }: HTMLAttributes<HTMLTableElement> & { containerClassName?: string }) => (
  <div className={cn("relative w-full overflow-auto", containerClassName)}>
    <table className={cn("w-full caption-bottom border-collapse text-sm tabular-nums", className)} {...p} />
  </div>
);
export const THead = ({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("sticky top-0 z-[1] bg-card [&_tr]:border-b [&_tr]:hover:bg-transparent", className)} {...p} />
);
export const TBody = ({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn("[&_tr:last-child]:border-0", className)} {...p} />
);
export const TR = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("border-b transition-colors hover:bg-white/[0.03]", className)} {...p} />
);
export const TH = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn("caps h-9 px-3 text-left align-middle text-[10px] font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4", className)}
    {...p}
  />
);
export const TD = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-2.5 align-middle first:pl-4 last:pr-4", className)} {...p} />
);
