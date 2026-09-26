"use client";
import { Repeat } from "lucide-react";
import type { LenientBountyMissionsResponse } from "@groundtruth/shared";
import { Panel, PanelHeader } from "@/components/ds/primitives";
import { ErrorBox } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/client/api";
import { formatTime } from "@/lib/client/cn";
import { useApi } from "@/lib/client/useApi";

type Series = LenientBountyMissionsResponse["recession"][number];

const TONE: Record<string, "success" | "progress" | "muted" | "warning"> = {
  open: "progress",
  filled: "success",
  expired: "muted",
  cancelled: "warning",
};

/**
 * Revisit missions on a request (owner/admin): upcoming/open/filled counts, the next few due, and a
 * small depth-over-time sparkline per cell chain (root reading + its revisits). Nothing heavy: one
 * request every 15 s.
 */
export function MissionsPanel({ bountyId }: { bountyId: string }) {
  const q = useApi(() => api.bountyMissions(bountyId), `missions:${bountyId}`, 15_000);
  const d = q.data;
  if (!d || (d.missions.length === 0 && d.recession.length === 0)) {
    return q.error ? <ErrorBox message={q.error} className="mx-6 my-3" /> : null;
  }
  const now = Date.now();
  const upcoming = d.missions.filter((m) => m.status === "open" && Date.parse(m.opens_at) > now);
  const open = d.missions.filter((m) => m.status === "open" && Date.parse(m.opens_at) <= now);
  const filled = d.missions.filter((m) => m.status === "filled");
  const next = [...upcoming, ...open].sort((a, b) => a.due_at.localeCompare(b.due_at)).slice(0, 4);
  const series = d.recession.filter((s) => s.points.length > 0).slice(0, 6);

  return (
    <Panel className="mx-6 my-4">
      <PanelHeader
        title="Revisit missions"
        icon={Repeat}
        actions={
          <span className="caps text-[10px] text-muted-foreground">
            {upcoming.length} upcoming · {open.length} open · {filled.length} filled
          </span>
        }
      />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <ul className="space-y-1.5 text-xs" aria-label="Next revisits">
          {next.length === 0 ? <li className="text-muted-foreground">No revisits due. Accepted readings schedule new ones.</li> : null}
          {next.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3">
              <span className="truncate">
                <span className="font-mono text-muted-foreground">{m.cell.slice(-6)}</span> · +{m.interval_min} min · due {formatTime(m.due_at)}
              </span>
              <Badge tone={TONE[m.status] ?? "muted"}>{Date.parse(m.opens_at) > now ? "upcoming" : m.status}</Badge>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Recession by cell">
          {series.map((s) => (
            <Sparkline key={s.root_submission_id} s={s} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

/** One chain: value (e.g. depth_cm) over minutes since the first reading. Single series, one hue. */
function Sparkline({ s }: { s: Series }) {
  const W = 120;
  const H = 36;
  const pts = s.points.filter((p): p is typeof p & { value: number } => p.value !== null);
  const maxT = Math.max(1, ...s.points.map((p) => p.minutes));
  const maxV = Math.max(1, ...pts.map((p) => p.value));
  const x = (t: number) => 4 + (t / maxT) * (W - 8);
  const y = (v: number) => H - 4 - (v / maxV) * (H - 8);
  const unit = s.field?.endsWith("_cm") ? " cm" : "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  const label = pts.length
    ? `${first!.value}${unit} → ${last!.value}${unit} over ${last!.minutes} min`
    : `${s.points.length} reading${s.points.length === 1 ? "" : "s"}, no values`;
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full text-primary" role="img" aria-label={`Cell ${s.cell}: ${label}`}>
        <line x1={4} x2={W - 4} y1={H - 4} y2={H - 4} className="stroke-border" strokeWidth={1} />
        {pts.length > 1 ? (
          <polyline
            points={pts.map((p) => `${x(p.minutes)},${y(p.value)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {pts.map((p) => (
          <g key={p.submission_id}>
            <circle cx={x(p.minutes)} cy={y(p.value)} r={3} fill="currentColor" />
            <circle cx={x(p.minutes)} cy={y(p.value)} r={8} fill="transparent">
              <title>{`+${p.minutes} min: ${p.value}${unit}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <figcaption className="text-[10px] leading-tight text-muted-foreground">
        <span className="font-mono">{s.cell.slice(-6)}</span> · {label}
      </figcaption>
    </figure>
  );
}
