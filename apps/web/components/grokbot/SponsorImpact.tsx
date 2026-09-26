"use client";
import { Check, Copy, ExternalLink, FileBarChart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatCents } from "@groundtruth/shared";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import {
  IMPACT_PERIODS,
  impactRange,
  impactShareText,
  isTemplate,
  publicImpactPath,
  type ImpactPeriod,
  type LenientSponsorImpact,
} from "@/lib/client/grokbot";
import { useGrokbot } from "@/lib/client/useGrokbot";
import { Tabs } from "../ds/controls";
import { Panel, PanelHeader, Readout } from "../ds/primitives";
import { toast } from "../Toaster";
import { Button, buttonVariants } from "../ui/button";
import { GrokbotErrorNotice, GrokbotMessageBody, GrokbotProvenance, GrokbotSkeleton } from "./GrokbotCard";

const day = (iso: string) => (Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));

/** Aggregate readouts + highlights + narrative. Used by the admin report and the public page. */
export function ImpactBody({ r, dim = false }: { r: LenientSponsorImpact; dim?: boolean }) {
  return (
    <div className={cn("space-y-4", dim && "opacity-50 transition-opacity")} aria-busy={dim}>
      <p className="caps text-[10px] text-muted-foreground">
        {day(r.period_from)} – {day(r.period_to)}
      </p>
      <div className="@container"><div className="grid grid-cols-2 gap-4 @md:grid-cols-3 @2xl:grid-cols-5">
        <Readout size="sm" label="Contributed" value={formatCents(r.contributed_cents)} />
        <Readout size="sm" label="Paid out" value={formatCents(r.spent_cents)} sub="to contributors" />
        <Readout size="sm" label="Accepted" value={r.observations_accepted.toLocaleString()} sub="verified observations" />
        <Readout size="sm" label="Cells" value={r.cells_covered.toLocaleString()} sub="map cells covered" />
        <Readout size="sm" label="Requests" value={r.requests_funded.toLocaleString()} sub="funded" />
      </div></div>
      {r.highlights.length ? (
        <ul className="space-y-1 border-t pt-3 text-sm">
          {r.highlights.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary" aria-hidden>
                ·
              </span>
              {h}
            </li>
          ))}
        </ul>
      ) : null}
      {r.narrative ? (
        <div className="space-y-3 border-t pt-3">
          <GrokbotMessageBody message={r.narrative} />
          <GrokbotProvenance template={isTemplate(r.narrative)}>AI-generated · grounded in the pool ledger and accepted observations</GrokbotProvenance>
        </div>
      ) : null}
    </div>
  );
}

/** Admin → Funding: one sponsor's impact report with a period picker and copy/share. */
export function SponsorImpactReport({ sponsorId, className }: { sponsorId: string; className?: string }) {
  const [period, setPeriod] = useState<ImpactPeriod>("90d");
  const [copied, setCopied] = useState(false);
  const g = useGrokbot((refresh) => api.grokbotSponsorImpact(sponsorId, impactRange(period), refresh), `impact:${sponsorId}:${period}`);
  const publicPath = publicImpactPath(sponsorId);

  const copy = async () => {
    if (!g.data) return;
    const url = typeof window !== "undefined" ? new URL(publicPath, window.location.origin).toString() : publicPath;
    try {
      await navigator.clipboard.writeText(impactShareText(g.data, url));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn't copy. Select the text and copy it yourself.", "error");
    }
  };

  return (
    <Panel className={className}>
      <PanelHeader
        title="Impact report"
        icon={FileBarChart}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void copy()} disabled={!g.data}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy report"}
            </Button>
            <Link href={publicPath} target="_blank" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Public view <ExternalLink aria-hidden />
            </Link>
          </>
        }
      />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs label="Report period" size="sm" items={IMPACT_PERIODS} value={period} onChange={setPeriod} />
          {g.data || g.error?.retry ? (
            <Button variant="ghost" size="sm" onClick={() => void g.load(true)} disabled={g.loading}>
              Regenerate narrative
            </Button>
          ) : null}
        </div>
        {g.error ? <GrokbotErrorNotice error={g.error} onRetry={() => void g.load(false)} /> : null}
        {g.loading && !g.data ? <GrokbotSkeleton label="Adding up the ledger and writing the summary…" /> : null}
        {g.data ? <ImpactBody r={g.data} dim={g.loading} /> : null}
        <p className="text-[11px] text-muted-foreground">Aggregates only: the report never names or locates individual contributors. Money is simulated during the pilot.</p>
      </div>
    </Panel>
  );
}
