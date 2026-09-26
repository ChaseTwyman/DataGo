import type { HTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";

type P = HTMLAttributes<HTMLDivElement>;

/** Panel: hairline border on near-black, square corners, no shadow. Same as ds Panel. */
export const Card = ({ className, ...p }: P) => <div className={cn("rounded-sm border bg-card text-card-foreground", className)} {...p} />;
export const CardHeader = ({ className, ...p }: P) => <div className={cn("flex flex-col gap-1.5 px-5 pt-5 pb-3", className)} {...p} />;
/** Caps condensed title. */
export const CardTitle = ({ className, ...p }: P) => (
  <div className={cn("caps text-sm leading-tight font-semibold tracking-[0.12em] [&_svg]:stroke-[1.75]", className)} {...p} />
);
export const CardDescription = ({ className, ...p }: P) => <div className={cn("text-sm leading-relaxed text-muted-foreground", className)} {...p} />;
export const CardContent = ({ className, ...p }: P) => <div className={cn("px-5 pb-5", className)} {...p} />;
