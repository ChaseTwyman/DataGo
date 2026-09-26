"use client";
import { ArrowRight, ChevronRight, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { citationViews, isTemplate, type GrokbotErrorView, type LenientCitation, type LenientGrokbotMessage } from "@/lib/client/grokbot";
import { cn } from "@/lib/client/cn";
import { ErrorState, Notice, Panel, PanelHeader, Skeleton } from "../ds/primitives";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

/**
 * Everything Grokbot writes on the dashboard goes through these pieces, so the provenance label,
 * the template badge and the Sources list are never missing.
 */

export const AI_LABEL = "AI-generated · grounded in stored checks";

/** Small caps provenance line; `template` marks the deterministic fallback text. */
export function GrokbotProvenance({ template, children, className }: { template?: boolean; children?: ReactNode; className?: string }) {
  return (
    <p className={cn("caps flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground", className)}>
      <Sparkles className="size-3" strokeWidth={1.75} aria-hidden />
      <span>{children ?? AI_LABEL}</span>
      {template ? <TemplateBadge /> : null}
    </p>
  );
}

export function TemplateBadge() {
  return (
    <Badge tone="muted" title="Grok was unavailable, so this was written from a fixed template using the same stored checks.">
      template
    </Badge>
  );
}

/** "Sources" expander: every citation in plain language (stage label, friendly reason name, price reason as-is). */
export function GrokbotSources({ citations, className }: { citations: readonly LenientCitation[]; className?: string }) {
  const views = citationViews(citations);
  if (!views.length) return null;
  return (
    <details className={cn("group border-t pt-2", className)}>
      <summary className="caps flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />
        Sources <span className="tabular-nums">{views.length}</span>
      </summary>
      <ul className="mt-2 space-y-1.5 text-xs">
        {views.map((v, i) => (
          <li key={i} className="flex gap-2">
            <span className="caps w-24 shrink-0 pt-px text-[10px] text-muted-foreground">{v.kind}</span>
            <span className="min-w-0">
              <span className="text-foreground">{v.text}</span>
              {v.detail ? <span className="text-muted-foreground"> — {v.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Loading skeleton shaped like a message (headline + two paragraphs). */
export function GrokbotSkeleton({ label = "Grok is reading the stored checks…" }: { label?: string }) {
  return (
    <div className="space-y-2.5" role="status" aria-live="polite">
      <div className="caps flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="gt-skeleton inline-block size-1.5 rounded-full bg-primary" aria-hidden />
        {label}
      </div>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-3.5" />
      <Skeleton className="h-3.5 w-5/6" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}

/** Error view: "not on this server yet" is a calm info notice; real failures get the danger notice + retry. */
export function GrokbotErrorNotice({ error, onRetry }: { error: GrokbotErrorView; onRetry?: () => void }) {
  if (error.tone === "info") return <Notice tone="info">{error.message}</Notice>;
  return <ErrorState message={error.message} onRetry={error.retry ? onRetry : undefined} />;
}

/** Headline, paragraphs, next steps, sources: the body of a GrokbotMessage. */
export function GrokbotMessageBody({ message, sources = true }: { message: LenientGrokbotMessage; sources?: boolean }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold leading-snug">{message.headline}</p>
      {message.paragraphs.map((p, i) => (
        <p key={i} className="leading-relaxed text-foreground/85">
          {p}
        </p>
      ))}
      {message.next_steps.length ? (
        <div>
          <div className="caps text-[10px] text-muted-foreground">Next steps</div>
          <ul className="mt-1.5 space-y-1">
            {message.next_steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <ArrowRight className="mt-1 size-3 shrink-0 text-primary" aria-hidden />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sources ? <GrokbotSources citations={message.citations} /> : null}
    </div>
  );
}

/**
 * Reusable Grokbot card: title bar with regenerate, the message (or skeleton / error), and the
 * provenance line with a "template" badge when the fallback wrote it.
 */
export function GrokbotCard({
  title,
  icon = Sparkles,
  message,
  loading = false,
  error = null,
  onRegenerate,
  bare = false,
  className,
  loadingLabel,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  message: LenientGrokbotMessage | null;
  loading?: boolean;
  error?: GrokbotErrorView | null;
  onRegenerate?: () => void;
  /** Without its own border (inside another panel). */
  bare?: boolean;
  className?: string;
  loadingLabel?: string;
}) {
  const body = (
    <div className="space-y-3 p-4">
      {error ? <GrokbotErrorNotice error={error} onRetry={onRegenerate} /> : null}
      {loading && !message ? <GrokbotSkeleton label={loadingLabel} /> : null}
      {message ? (
        <div className={cn(loading && "opacity-50 transition-opacity")} aria-busy={loading}>
          <GrokbotMessageBody message={message} />
        </div>
      ) : null}
      {message ? <GrokbotProvenance template={isTemplate(message)} /> : null}
    </div>
  );
  const header = (
    <PanelHeader
      title={title}
      icon={icon}
      actions={
        onRegenerate && (message || error?.retry) ? (
          <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={loading} aria-label="Regenerate">
            <RefreshCw className={cn(loading && "animate-spin")} aria-hidden /> Regenerate
          </Button>
        ) : null
      }
    />
  );
  if (bare)
    return (
      <div className={className}>
        {header}
        {body}
      </div>
    );
  return (
    <Panel className={className}>
      {header}
      {body}
    </Panel>
  );
}
