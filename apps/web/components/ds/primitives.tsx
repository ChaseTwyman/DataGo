import { CircleAlert, Info, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/client/cn";

/**
 * Layout and state primitives. Vocabulary (same as /data and the phone app):
 * - Eyebrow: small caps line above a title.
 * - PageHeader: page title band.
 * - Panel: hairline-bordered block on near-black; PanelHeader is its caps title bar.
 * - Readout: big tabular numeral + small caps label (telemetry).
 * - EmptyState / LoadingState / ErrorState: the three non-data states every list needs.
 */

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("caps text-[11px] text-muted-foreground", className)}>{children}</p>;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b px-6 pt-6 pb-5", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <Eyebrow className="mb-2">{eyebrow}</Eyebrow> : null}
        <h1 className="caps flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-2xl leading-tight font-semibold tracking-[0.08em] sm:text-[28px]">
          {title}
        </h1>
        {description ? <div className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A titled region of a page: caps label with a hairline under it. */
export function Section({
  title,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3 border-b pb-2.5">
        <h2 className="caps text-[11px] font-medium text-muted-foreground">{title}</h2>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Panel({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-sm border bg-card text-card-foreground", className)} {...p} />;
}

export function PanelHeader({
  title,
  icon: Icon,
  actions,
  className,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-2 border-b px-4 py-2", className)}>
      <div className="caps flex items-center gap-2 text-xs font-semibold">
        {Icon ? <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden /> : null}
        {title}
      </div>
      {actions ? <div className="flex items-center gap-2 text-[11px] text-muted-foreground">{actions}</div> : null}
    </div>
  );
}

/** Telemetry readout: small caps label, large light tabular numeral, optional caption. */
export function Readout({
  label,
  value,
  sub,
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="caps truncate text-[10px] font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "numeral mt-1.5 truncate",
          size === "sm" ? "text-xl" : size === "lg" ? "text-4xl sm:text-5xl" : "text-[28px]",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** A row of readouts separated by hairlines, as on /data. */
export function ReadoutGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-hidden border-b">
      {/* Each cell draws its own right/bottom hairline; the -1px margins push the outer ones out of view. */}
      <div
        className={cn(
          "-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 [&>*]:px-6 [&>*]:py-4 [&>*]:shadow-[inset_-1px_-1px_0_var(--color-border)]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon: Icon,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-l-2 border-primary/70 py-2 pl-5", className)} role="status">
      <div className="caps flex items-center gap-2 text-xs font-semibold">
        {Icon ? <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden /> : null}
        {title}
      </div>
      {children ? <div className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("gt-skeleton rounded-sm", className)} aria-hidden />;
}

/**
 * Loading placeholder. `rows` skeleton bars (default 3) with the label for screen readers and as a
 * small caps caption; `inline` gives a one-line caption only (buttons, map boxes).
 */
export function LoadingState({
  label = "Loading…",
  rows = 3,
  inline = false,
  className,
}: {
  label?: string;
  rows?: number;
  inline?: boolean;
  className?: string;
}) {
  if (inline) {
    return (
      <div className={cn("caps flex items-center gap-2 p-6 text-[11px] text-muted-foreground", className)} role="status">
        <span className="gt-skeleton inline-block size-1.5 rounded-full bg-primary" aria-hidden />
        {label}
      </div>
    );
  }
  return (
    <div className={cn("space-y-2.5 p-6", className)} role="status" aria-live="polite">
      <div className="caps text-[11px] text-muted-foreground">{label}</div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-9", i === rows - 1 && "w-2/3")} />
      ))}
    </div>
  );
}

const NOTICE_TONE = {
  danger: { border: "border-destructive", text: "text-destructive", icon: CircleAlert },
  warning: { border: "border-warning", text: "text-warning", icon: TriangleAlert },
  info: { border: "border-primary", text: "text-primary", icon: Info },
} as const;

/** Inline message with a coloured rule, icon and text (never colour alone). */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: keyof typeof NOTICE_TONE;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const t = NOTICE_TONE[tone];
  const Icon = t.icon;
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn("flex items-start gap-3 border border-l-2 bg-card px-4 py-3 text-sm", t.border, className)}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", t.text)} strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <div className="caps text-xs font-semibold">{title}</div> : null}
        {children ? <div className={cn("break-words whitespace-pre-wrap text-foreground/85", title ? "mt-1" : "")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Inline failure. `message` must already be user copy — pass `errorMessage(e)`
 * (lib/client/errors.ts), never `e.message`. Renders nothing for an empty message.
 */
export function ErrorState({ message, className, onRetry }: { message: string | null | undefined; className?: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <Notice
      tone="danger"
      className={className}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="caps inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-foreground hover:text-primary"
          >
            <RotateCcw className="size-3" aria-hidden /> Try again
          </button>
        ) : undefined
      }
    >
      {message}
    </Notice>
  );
}

/** Label/value list for detail panels. */
export function KeyValue({ items, className }: { items: { k: ReactNode; v: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y text-sm", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="caps text-[10px] text-muted-foreground">{it.k}</dt>
          <dd className="min-w-0 text-right tabular-nums">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Long-running job (model drafting, scans): caps stage line, thin accent progress rule, caption. */
export function JobProgress({ stage, pct, children, className }: { stage: ReactNode; pct: number; children?: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("space-y-3 border border-l-2 border-l-primary bg-card p-4 text-sm", className)}>
      <div className="caps flex items-center gap-2 text-xs font-semibold">
        <span className="gt-skeleton inline-block size-1.5 rounded-full bg-primary" aria-hidden />
        {stage}
      </div>
      <div className="h-px bg-input" aria-hidden>
        <div className="-mt-px h-[3px] bg-primary transition-[width] duration-1000" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      {children ? <p className="text-xs text-muted-foreground tabular-nums">{children}</p> : null}
    </div>
  );
}
