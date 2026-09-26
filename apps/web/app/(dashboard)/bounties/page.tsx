"use client";
import { Crosshair, LoaderCircle, Plus, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEMO, formatCents } from "@groundtruth/shared";
import { RelativeTime } from "@/components/ds/RelativeTime";
import { HexMap } from "@/components/map";
import { Empty, ErrorBox, Loading, PageHeader } from "@/components/page";
import { BountyStatusBadge } from "@/components/status";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/client/api";
import { useHealth } from "@/lib/client/health";
import { useApi } from "@/lib/client/useApi";

export default function BountiesPage() {
  const { data: health } = useHealth();
  const list = useApi(() => api.bounties(), "bounties", 10_000);

  return (
    <>
      <PageHeader
        title="Bounties"
        description="Paid requests for real-world observations, priced per H3 cell."
        actions={
          <Link href="/bounties/new" className={buttonVariants()}>
            <Plus aria-hidden /> New bounty
          </Link>
        }
      />
      <div className="space-y-6 p-6">
        {health?.demo_mode ? <SpawnDemoCard /> : null}
        <ErrorBox message={list.error} />
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && list.data.bounties.length === 0 ? (
          <Empty title="No bounties yet">Create one, or spawn the demo event.</Empty>
        ) : null}
        {list.data && list.data.bounties.length > 0 ? (
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>Bounty</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Cells</TH>
                  <TH className="text-right">Accepted</TH>
                  <TH className="text-right">To review</TH>
                  <TH className="text-right">Budget</TH>
                  <TH>Ends</TH>
                </TR>
              </THead>
              <TBody>
                {list.data.bounties.map((b) => {
                  const pct = b.budget_cents > 0 ? Math.min(100, (b.spent_cents / b.budget_cents) * 100) : 0;
                  return (
                    <TR key={b.id}>
                      <TD>
                        <Link href={`/bounties/${b.id}`} className="font-medium hover:text-primary">
                          {b.title}
                        </Link>
                        <div className="text-xs text-muted-foreground">{b.protocol_name}</div>
                      </TD>
                      <TD>
                        <BountyStatusBadge status={b.status} />
                      </TD>
                      <TD className="text-right tabular-nums">{b.cells_total}</TD>
                      <TD className="text-right font-medium tabular-nums">{b.accepted}</TD>
                      <TD className="text-right tabular-nums">
                        {b.pending_review > 0 ? (
                          <Link href="/review" className="font-medium text-warning hover:underline">
                            {b.pending_review}
                          </Link>
                        ) : (
                          0
                        )}
                      </TD>
                      <TD className="min-w-40">
                        <div className="text-right text-xs tabular-nums">
                          {formatCents(b.spent_cents)} <span className="text-muted-foreground">/ {formatCents(b.budget_cents)}</span>
                        </div>
                        <div className="mt-1.5 h-px bg-input" aria-hidden>
                          <div className="-mt-px h-[3px] bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      </TD>
                      <TD className="text-xs whitespace-nowrap text-muted-foreground">
                        <RelativeTime iso={b.ends_at} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        ) : null}
      </div>
    </>
  );
}

/** DEMO_MODE only: click the map, spawn an active flood bounty centered there (PRD §19 / M8). */
function SpawnDemoCard() {
  const router = useRouter();
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spawn = async () => {
    if (!point) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.spawnEvent(point.lat, point.lng);
      router.push(`/bounties/${r.bounty_id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden border-warning/40">
      <div className="grid md:grid-cols-[1fr_320px]">
        <div className="h-64 border-b md:h-72 md:border-r md:border-b-0">
          <HexMap
            center={{ lat: DEMO.lat, lng: DEMO.lng }}
            zoom={13}
            marker={point}
            onMapClick={(lat, lng) => setPoint({ lat, lng })}
            cursor="crosshair"
          />
        </div>
        <div className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4 text-warning" aria-hidden /> Demo event
            </CardTitle>
            <CardDescription>
              Click the map at your venue, then spawn a live flash-flood bounty there (event started 20 min ago, a few
              accepted observations seeded nearby).
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto space-y-2">
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground tabular-nums">
              <Crosshair className="size-3.5" aria-hidden />
              {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "No point selected"}
            </div>
            <Button className="w-full" disabled={!point || busy} onClick={() => void spawn()}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Zap aria-hidden />}
              Spawn demo event here
            </Button>
            <ErrorBox message={error} />
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
