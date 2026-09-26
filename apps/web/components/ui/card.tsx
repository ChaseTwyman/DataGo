import type { HTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";

type P = HTMLAttributes<HTMLDivElement>;

export const Card = ({ className, ...p }: P) => (
  <div className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: P) => (
  <div className={cn("flex flex-col gap-1 px-5 pt-5 pb-3", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: P) => (
  <div className={cn("text-sm font-semibold leading-none tracking-tight", className)} {...p} />
);
export const CardDescription = ({ className, ...p }: P) => (
  <div className={cn("text-sm text-muted-foreground", className)} {...p} />
);
export const CardContent = ({ className, ...p }: P) => <div className={cn("px-5 pb-5", className)} {...p} />;
