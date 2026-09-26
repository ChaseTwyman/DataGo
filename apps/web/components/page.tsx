import { CircleAlert, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3 border-b bg-card px-6 py-4", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <div className="mt-0.5 text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Inline failure notice. `message` must already be user copy — pass `errorMessage(e)`
 * (lib/client/errors.ts), never `e.message`.
 */
export function ErrorBox({ message, className, onRetry }: { message: string | null | undefined; className?: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn("flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800", className)}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="flex-1 break-words whitespace-pre-wrap">{message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 cursor-pointer font-medium underline underline-offset-2 hover:text-red-950">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 p-6 text-sm text-muted-foreground", className)}>
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-dashed p-8 text-center", className)}>
      <div className="text-sm font-medium">{title}</div>
      {children ? <div className="mt-1 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
