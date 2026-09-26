"use client";
import { FileSearch, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { citationView, groupEvidence, isTemplate, strengthMeta, type LenientReviewBrief } from "@/lib/client/grokbot";
import { useGrokbot } from "@/lib/client/useGrokbot";
import { Panel, PanelHeader } from "../ds/primitives";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { GrokbotErrorNotice, GrokbotProvenance, GrokbotSkeleton } from "./GrokbotCard";

export const BRIEF_FOOTER = "Grok summarizes evidence; you decide.";

/**
 * Reviewer brief for a needs_review submission: evidence grouped by what it bears on, uncertainty,
 * and manual checks. It carries NO recommendation (the contract has no verdict field and the parser
 * strips one); it sits beside the human Approve/Reject controls, never above them.
 */
export function ReviewBrief({ submissionId, autoLoad = false, className }: { submissionId: string; autoLoad?: boolean; className?: string }) {
  const [requested, setRequested] = useState(autoLoad);
  const g = useGrokbot((refresh) => api.grokbotReviewBrief(submissionId, refresh), `brief:${submissionId}`, requested);
  return (
    <Panel className={cn("min-w-0", className)}>
      <PanelHeader
        title="Brief"
        icon={FileSearch}
        actions={
          requested && (g.data || g.error?.retry) ? (
            <Button variant="ghost" size="sm" onClick={() => void g.load(true)} disabled={g.loading} aria-label="Regenerate brief">
              <RefreshCw className={cn(g.loading && "animate-spin")} aria-hidden /> Regenerate
            </Button>
          ) : null
        }
      />
      <div className="space-y-4 p-4 text-sm">
        {!requested ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">A summary of the stored evidence and what it leaves uncertain, to help you review.</p>
            <Button variant="outline" size="sm" onClick={() => setRequested(true)}>
              <FileSearch aria-hidden /> Get brief
            </Button>
          </div>
        ) : null}
        {g.error ? <GrokbotErrorNotice error={g.error} onRetry={() => void g.load(false)} /> : null}
        {requested && g.loading && !g.data ? <GrokbotSkeleton label="Grok is summarizing the evidence…" /> : null}
        {g.data ? <BriefBody brief={g.data} dim={g.loading} /> : null}
        <p className="caps border-t pt-2 text-[10px] text-muted-foreground">{BRIEF_FOOTER}</p>
      </div>
    </Panel>
  );
}

export function BriefBody({ brief, dim = false }: { brief: LenientReviewBrief; dim?: boolean }) {
  const groups = groupEvidence(brief.evidence);
  return (
    <div className={cn("space-y-4", dim && "opacity-50 transition-opacity")} aria-busy={dim}>
      {brief.injection_flags.length ? (
        <div role="alert" className="border border-l-2 border-warning bg-warning/[0.06] px-3 py-2.5">
          <div className="caps flex items-center gap-2 text-xs font-semibold text-warning">
            <ShieldAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            Contributor text contained instructions aimed at AI — ignored
          </div>
          <ul className="mt-2 space-y-1 text-xs text-foreground/85">
            {brief.injection_flags.map((f, i) => (
              <li key={i} className="border-l pl-2 font-mono break-words">
                “{f}”
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">Grok treated this as data, not instructions. Weigh it yourself.</p>
        </div>
      ) : null}

      <p className="leading-relaxed">{brief.summary}</p>

      {groups.length ? (
        <div className="space-y-3">
          <div className="caps text-[10px] text-muted-foreground">Evidence</div>
          {groups.map((grp) => (
            <section key={grp.id}>
              <h5 className="caps border-b pb-1 text-[10px] font-semibold">{grp.label}</h5>
              <ul className="divide-y">
                {grp.items.map((it, i) => {
                  const s = strengthMeta(it.strength);
                  const src = it.citation ? citationView(it.citation) : null;
                  return (
                    <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                      <div className="min-w-0">
                        <p className="leading-snug">{it.claim}</p>
                        {src ? (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {src.kind}: {src.text}
                            {src.detail ? ` — ${src.detail}` : ""}
                          </p>
                        ) : null}
                      </div>
                      <Badge tone={s.tone} className="shrink-0">
                        {s.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No stored evidence was cited.</p>
      )}

      <BriefList title="Uncertain" items={brief.uncertainties} />
      <BriefList title="Check yourself" items={brief.suggested_checks} />
      <GrokbotProvenance template={isTemplate(brief)} />
    </div>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="caps text-[10px] text-muted-foreground">{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
