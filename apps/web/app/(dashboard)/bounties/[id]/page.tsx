"use client";
import { ArrowLeft, Database, Pause, Play, Radio, Swords, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatCents, formatSurge, isHotSurge } from "@groundtruth/shared";
import { HexMap, MapLegend, type MapPoint } from "@/components/map";
import { Empty, ErrorBox, Loading, PageHeader, Stat } from "@/components/page";
import { BriefingVideo } from "@/components/BriefingVideo";
import { BountyStatusBadge } from "@/components/status";
import { SubmissionCard } from "@/components/submissions/SubmissionCard";
import { SyntheticImage } from "@/components/SyntheticImage";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/client/api";
import { cn, formatTime } from "@/lib/client/cn";
import { summarizeCoverage } from "@/lib/client/coverage";
import { useSubmissionStream } from "@/lib/client/realtime";
import { useApi } from "@/lib/client/useApi";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "accepted", label: "Accepted" },
  { id: "needs_review", label: "Review" },
  { id: "rejected", label: "Rejected" },
  { id: "verifying", label: "In progress" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

export default function BountyPage() {
  const { id } = useParams<{ id: string }>();
  const bounty = useApi(() => api.bounty(id), `bounty:${id}`);
  const coverage = useApi(() => api.coverage(id), `coverage:${id}`, 5000);
  const stream = useSubmissionStream({
    bountyId: id,
    limit: 200,
    onBountyChange: () => {
      void bounty.refresh();
      void coverage.refresh();
    },
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [actionError, setActionError] = useState<string | null>(null);
  // BountyDetail has no owner field; GET /api/bounties lists exactly the bounties this researcher
  // manages (admins: all). If that list fails, offer the action and let the server decide.
  const mine = useApi(() => api.bounties(), "bounties:mine");
  const canManage = mine.error ? true : (mine.data?.bounties.some((x) => x.id === id) ?? false);

  // New arrivals or decisions change coverage/prices: refresh right away instead of waiting for the tick.
  const acceptedCount = stream.submissions.filter((s) => s.status === "accepted").length;
  const { refresh: refreshCoverage } = coverage;
  useEffect(() => {
    void refreshCoverage();
  }, [acceptedCount, stream.freshIds, refreshCoverage]);

  const b = bounty.data;
  const cells = coverage.data?.cells ?? b?.coverage ?? [];
  const summary = useMemo(() => summarizeCoverage(cells), [cells]);
  const points: MapPoint[] = useMemo(
    () =>
      stream.submissions
        .filter((s) => s.status === "accepted")
        .map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, status: s.status })),
    [stream.submissions],
  );
  const shown = filter === "all" ? stream.submissions : stream.submissions.filter((s) => s.status === filter || (filter === "verifying" && s.status === "pending"));

  const setStatus = async (status: "active" | "paused" | "closed") => {
    setActionError(null);
    try {
      await api.patchBounty(id, { status });
      await bounty.refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  if (bounty.loading && !b) return <Loading />;
  if (!b)
    return (
      <ErrorBox
        className="m-6"
        message={bounty.error ?? "We couldn't find that bounty. It may have been removed."}
        onRetry={bounty.error ? () => void bounty.refresh() : undefined}
      />
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {b.title} <BountyStatusBadge status={b.status} />
            {b.source === "demo" ? <Badge tone="warning">demo</Badge> : null}
          </span>
        }
        description={
          <>
            {b.protocol.name} · ends {formatTime(b.ends_at)}
            {b.event_started_at ? ` · event started ${formatTime(b.event_started_at)}` : ""}
            {b.sponsor_name ? (
              <>
                {" · Funded by "}
                {b.sponsor_url ? (
                  <a href={b.sponsor_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {b.sponsor_name}
                  </a>
                ) : (
                  <span className="font-medium text-foreground">{b.sponsor_name}</span>
                )}
                {" — data free for everyone"}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <Link href="/bounties" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <ArrowLeft aria-hidden /> All
            </Link>
            <Link href={`/datasets?bounty=${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Database aria-hidden /> Dataset
            </Link>
            <Link href={`/red-team?bounty=${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Swords aria-hidden /> Red team
            </Link>
            {b.status === "active" ? (
              <Button variant="outline" size="sm" onClick={() => void setStatus("paused")}>
                <Pause aria-hidden /> Pause
              </Button>
            ) : b.status === "paused" || b.status === "draft" ? (
              <Button size="sm" onClick={() => void setStatus("active")}>
                <Play aria-hidden /> Activate
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorBox message={actionError ?? coverage.error} className="mx-6 mt-3" />

      <div className="grid grid-cols-2 gap-4 border-b bg-card px-6 py-3 sm:grid-cols-5">
        <Stat label="Coverage" value={`${summary.accepted} / ${summary.target}`} sub={`${Math.round(summary.ratio * 100)}% of target`} />
        <Stat label="Cells" value={summary.cells} sub={summary.paused ? `${summary.paused} paused` : "none paused"} />
        <Stat
          label="Top surge"
          value={<span className={cn(isHotSurge(summary.maxSurge) && "text-amber-600")}>{formatSurge(summary.maxSurge || 1)}</span>}
          sub={`base ${formatCents(b.base_price_cents)} · max ${formatCents(b.max_price_cents)}`}
        />
        <Stat label="Spent" value={formatCents(b.spent_cents)} sub={`of ${formatCents(b.budget_cents)}`} />
        <Stat label="Submissions" value={stream.submissions.length} sub={`${acceptedCount} accepted`} />
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_460px]">
        <div className="relative min-h-[420px]">
          <HexMap
            center={{ lat: b.center_lat, lng: b.center_lng }}
            zoom={14}
            cells={cells}
            points={points}
            flyKey={id}
            className="absolute inset-0"
          />
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
            <div className="pointer-events-auto space-y-2">
              {summary.pausedReasons.length ? (
                <div className="max-w-sm rounded-md border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs text-amber-900 shadow-sm">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <TriangleAlert className="size-3.5" aria-hidden /> {summary.paused} cell{summary.paused === 1 ? "" : "s"} paused —
                    capture disabled
                  </div>
                  <ul className="mt-0.5 list-disc pl-5">
                    {summary.pausedReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <MapLegend />
            </div>
            <div className="flex items-end gap-2">
              <BriefingVideo
                bountyId={id}
                videoUrl={b.briefing_video_url}
                canManage={canManage}
                refresh={bounty.refresh}
                className="pointer-events-auto w-36"
              />
              {b.example_image_url ? (
                <SyntheticImage
                  src={b.example_image_url}
                  label="Example — AI-generated"
                  alt="Protocol example image"
                  className="pointer-events-auto w-44 shadow-md"
                />
              ) : null}
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col border-l bg-background">
          <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Radio className="size-4 text-red-500" aria-hidden /> Live submissions
            </div>
            <span className="text-[11px] text-muted-foreground">
              {stream.mode === "realtime" ? "realtime" : "polling every 2 s"}
            </span>
          </div>
          <div className="flex gap-1 border-b bg-card px-3 py-2" role="tablist" aria-label="Filter submissions">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium",
                  filter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            <ErrorBox message={stream.error} />
            {stream.loading ? <Loading label="Loading stream…" /> : null}
            {!stream.loading && shown.length === 0 ? (
              <Empty title="Nothing here yet">Submissions appear here the moment they arrive.</Empty>
            ) : null}
            {shown.map((s) => (
              <SubmissionCard key={s.id} s={s} fresh={stream.freshIds.includes(s.id)} />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
