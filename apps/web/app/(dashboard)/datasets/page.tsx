"use client";
import { BookOpen, Download, FileJson, FileSpreadsheet, LoaderCircle } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { formatCents } from "@groundtruth/shared";
import { RelativeTime } from "@/components/ds/RelativeTime";
import { BountySelect, useSelectedBounty } from "@/components/BountyPicker";
import { Empty, ErrorBox, Loading, PageHeader } from "@/components/page";
import { toast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, errorMessage, type ExportFormat } from "@/lib/client/api";
import { formatScore, formatValue } from "@/lib/client/checkFormat";
import { shortId } from "@/lib/client/cn";
import { useSubmissionStream } from "@/lib/client/realtime";
import { useApi } from "@/lib/client/useApi";

export default function DatasetsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Datasets />
    </Suspense>
  );
}

function Datasets() {
  const pick = useSelectedBounty();
  const bountyId = pick.selected?.id;
  const detail = useApi(bountyId ? () => api.bounty(bountyId) : null, `bounty:${bountyId ?? ""}`);
  const stream = useSubmissionStream({ bountyId, status: "accepted", limit: 200, enabled: Boolean(bountyId) });

  // Column set = the protocol's extraction schema fields, in schema order.
  const fields = useMemo(() => {
    const props = detail.data?.protocol.extraction_schema.properties;
    if (props) return Object.keys(props);
    const keys = new Set<string>();
    for (const s of stream.submissions) for (const k of Object.keys(s.extracted ?? {})) keys.add(k);
    return [...keys];
  }, [detail.data, stream.submissions]);

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Accepted observations with provenance and confidence. Synthetic media never appears here."
        actions={
          <BountySelect bounties={pick.bounties} value={bountyId} onChange={pick.select} />
        }
      />
      <div className="space-y-4 p-6">
        <ErrorBox message={pick.error ?? detail.error ?? stream.error} />
        {bountyId ? <ExportBar bountyId={bountyId} count={stream.submissions.length} /> : null}
        {pick.loading || (bountyId && stream.loading) ? <Loading /> : null}
        {!pick.loading && !bountyId ? <Empty title="No bounties">Create a bounty to start collecting data.</Empty> : null}
        {bountyId && !stream.loading && stream.submissions.length === 0 ? (
          <Empty title="No accepted observations yet">Rows appear here as submissions are accepted.</Empty>
        ) : null}
        {stream.submissions.length > 0 ? (
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>Captured</TH>
                  {fields.map((f) => (
                    <TH key={f} className="font-mono">
                      {f}
                    </TH>
                  ))}
                  <TH className="text-right">Confidence</TH>
                  <TH className="text-right">Payout</TH>
                  <TH>Location</TH>
                  <TH>Provenance</TH>
                </TR>
              </THead>
              <TBody>
                {stream.submissions.map((s) => (
                  <TR key={s.id} className={stream.freshIds.includes(s.id) ? "gt-arrive" : undefined}>
                    <TD className="text-xs whitespace-nowrap">
                      <RelativeTime iso={s.captured_at} />
                    </TD>
                    {fields.map((f) => (
                      <TD key={f} className="max-w-56 truncate text-xs" title={formatValue(s.extracted?.[f])}>
                        {formatValue(s.extracted?.[f])}
                      </TD>
                    ))}
                    <TD className="text-right font-mono text-xs tabular-nums">{formatScore(s.confidence)}</TD>
                    <TD className="text-right text-xs tabular-nums">{s.payout_cents !== null ? formatCents(s.payout_cents) : "—"}</TD>
                    <TD className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                      {s.accuracy_m !== null ? ` ±${Math.round(s.accuracy_m)}m` : ""}
                    </TD>
                    <TD className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      sub {shortId(s.id)} · user {shortId(s.user_id)} · {s.media.length} frame{s.media.length === 1 ? "" : "s"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        ) : null}
      </div>
    </>
  );
}

const EXPORTS: { format: ExportFormat; label: string; icon: typeof Download }[] = [
  { format: "csv", label: "CSV", icon: FileSpreadsheet },
  { format: "geojson", label: "GeoJSON", icon: FileJson },
  { format: "dictionary", label: "Data dictionary", icon: BookOpen },
];

function ExportBar({ bountyId, count }: { bountyId: string; count: number }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const run = async (format: ExportFormat) => {
    setBusy(format);
    try {
      await api.download(bountyId, format);
    } catch (e) {
      // A failed export is a toast, never a blank page or a JSON download.
      toast(`${EXPORTS.find((x) => x.format === format)?.label ?? "Export"} export failed. ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-3 flex items-baseline gap-2 text-muted-foreground">
        <span className="numeral text-2xl text-foreground">{count}</span>
        <span className="caps text-[11px]">accepted observation{count === 1 ? "" : "s"}</span>
      </span>
      {EXPORTS.map((x) => (
        <Button key={x.format} variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(x.format)}>
          {busy === x.format ? <LoaderCircle className="animate-spin" aria-hidden /> : <x.icon aria-hidden />}
          {x.label}
        </Button>
      ))}
    </div>
  );
}
