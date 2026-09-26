"use client";
import { Coins, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatCents, type LenientBountyDetail } from "@groundtruth/shared";
import { useConfirm } from "@/components/ds/Dialog";
import { Notice, Panel, PanelHeader, Readout } from "@/components/ds/primitives";
import { GrokbotAsk } from "@/components/grokbot/GrokbotAsk";
import { ErrorBox } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/client/api";
import { useMe } from "@/lib/client/me";

const PACE: Record<string, { label: string; tone: "success" | "warning" | "muted" }> = {
  on_track: { label: "On track", tone: "success" },
  ahead: { label: "Spending fast — prices paced down", tone: "warning" },
  behind: { label: "Under-spending — prices boosted", tone: "muted" },
  unfunded: { label: "Not funded yet", tone: "warning" },
};

/**
 * Funding + pricing panel on a request's page (owner/admin only; the API sends `funding: null` to
 * everyone else). Shows the pool allocation, where it came from, pacing, and why a request is still
 * waiting. Admins adjust allocations on /admin/funding.
 */
export function FundingPanel({ bounty, onChanged }: { bounty: LenientBountyDetail; onChanged: () => void | Promise<void> }) {
  const f = bounty.funding;
  const { me } = useMe();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!f) return null;
  const pace = PACE[f.pace] ?? { label: f.pace.replace(/_/g, " "), tone: "muted" as const };
  const used = f.allocation_cents > 0 ? Math.min(100, ((f.spent_cents + f.committed_cents) / f.allocation_cents) * 100) : 0;

  const close = async () => {
    if (
      !(await confirm({
        title: "Close request",
        body: "Close this request? Contributors can no longer capture, and its unspent allocation returns to the sponsor pool.",
        confirmLabel: "Close request",
        tone: "danger",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.patchBounty(bounty.id, { status: "closed" });
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="mx-6 my-4">
      <PanelHeader
        title="Funding and pricing"
        icon={Coins}
        actions={
          <>
            <Badge tone={pace.tone}>{pace.label}</Badge>
            {me?.is_admin ? (
              <Link href={`/admin/funding#request-${bounty.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Adjust
              </Link>
            ) : null}
            {bounty.status !== "closed" ? (
              <Button variant="outline" size="sm" onClick={() => void close()} disabled={busy}>
                {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Close
              </Button>
            ) : null}
          </>
        }
      />
      {bounty.status === "pending_funding" ? (
        <Notice tone="warning" title="Awaiting funding" className="m-4 mb-0">
          {f.funding_reason ?? "The allocation engine hasn't funded this request yet."}
        </Notice>
      ) : null}
      <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
        <Readout size="sm" label="Allocation" value={formatCents(f.allocation_cents)} sub={`est. need ${formatCents(f.estimated_need_cents)}`} />
        <Readout size="sm" label="Paid out" value={formatCents(f.spent_cents)} />
        <Readout size="sm" label="Promised" value={formatCents(f.committed_cents)} sub="locked quotes, worst case" />
        <Readout size="sm" label="Remaining" value={formatCents(f.remaining_cents)} />
        <Readout size="sm" label="Price range" value={`${formatCents(f.base_cents)}–${formatCents(f.ceiling_cents)}`} sub="per reading, set by GroundTruth" />
      </div>
      {f.allocation_cents > 0 ? (
        <div className="px-4 pb-3">
          <div className="h-1 w-full bg-muted" role="progressbar" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100} aria-label="Allocation used">
            <div className="h-1 bg-primary" style={{ width: `${used}%` }} />
          </div>
        </div>
      ) : null}
      {f.sources.length ? (
        <ul className="space-y-1 border-t px-4 py-3 text-xs text-muted-foreground">
          {f.sources.map((s, i) => (
            <li key={`${s.sponsor_name}-${i}`} className="flex justify-between gap-3">
              <span>
                <span className="text-foreground">{s.sponsor_name}</span> · {s.earmark}
              </span>
              <span className="tabular-nums">{formatCents(s.amount_cents)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {bounty.justification ? <p className="border-t px-4 py-3 text-xs text-muted-foreground">Justification: {bounty.justification}</p> : null}
      <GrokbotAsk
        className="border-t px-4 py-3"
        label={bounty.status === "pending_funding" ? "Why is this pending?" : bounty.status === "paused" ? "Why is this paused?" : "How is this funded?"}
        title="Request status"
        cacheKey={`status:${bounty.id}:${bounty.status}`}
        load={(refresh) => api.grokbotBountyStatus(bounty.id, refresh)}
        defaultOpen={bounty.status === "pending_funding"}
      />
      <ErrorBox message={error} className="m-4 mt-0" />
    </Panel>
  );
}
