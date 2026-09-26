"use client";
import { ArrowLeft, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { cellsForCircle, DEMO, formatCents, formatSurge, isHotSurge, urgencyTauHours } from "@groundtruth/shared";
import { HexMap, MapLegend } from "@/components/map";
import { ErrorBox, PageHeader, Stat } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/client/api";
import { dollarsToCents, isoToLocalInput, localInputToIso, previewPrices } from "@/lib/client/pricePreview";
import { useApi } from "@/lib/client/useApi";

const RADIUS_MIN = 100;
const RADIUS_MAX = 5000;

export default function NewBountyPage() {
  const router = useRouter();
  const protocols = useApi(() => api.protocols(), "protocols");

  const now = useMemo(() => new Date(), []);
  const [protocolId, setProtocolId] = useState("");
  const [title, setTitle] = useState("Flash flood: street depth");
  const [summary, setSummary] = useState("Street-level flood depth readings to calibrate the city flood model.");
  const [center, setCenter] = useState<{ lat: number; lng: number }>({ lat: DEMO.lat, lng: DEMO.lng });
  const [radius, setRadius] = useState<number>(DEMO.radiusM);
  const [startsAt, setStartsAt] = useState(isoToLocalInput(now));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(new Date(now.getTime() + 24 * 3_600_000)));
  const [hasEvent, setHasEvent] = useState(true);
  const [eventAt, setEventAt] = useState(isoToLocalInput(new Date(now.getTime() - 30 * 60_000)));
  const [base, setBase] = useState("2.00");
  const [max, setMax] = useState("10.00");
  const [target, setTarget] = useState(5);
  const [priority, setPriority] = useState(1);
  const [budget, setBudget] = useState("500");
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorUrl, setSponsorUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = protocols.data?.protocols ?? [];
  useEffect(() => {
    if (!protocolId && list[0]) setProtocolId(list[0].id);
  }, [list, protocolId]);
  const protocol = list.find((p) => p.id === protocolId)?.definition ?? null;

  const cells = useMemo(() => cellsForCircle(center.lat, center.lng, radius), [center, radius]);
  const baseCents = dollarsToCents(base);
  const maxCents = dollarsToCents(max);
  const budgetCents = dollarsToCents(budget);
  const eventIso = hasEvent ? localInputToIso(eventAt) : null;
  const preview = useMemo(
    () =>
      previewPrices({
        cells,
        baseCents: Number.isFinite(baseCents) ? baseCents : 0,
        maxCents: Number.isFinite(maxCents) ? maxCents : 0,
        targetPerCell: target,
        priority,
        tauHours: protocol ? urgencyTauHours(protocol) : 3,
        eventStartedAt: eventIso,
      }),
    [cells, baseCents, maxCents, target, priority, protocol, eventIso],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const starts = localInputToIso(startsAt);
    const ends = localInputToIso(endsAt);
    if (!protocolId) return setError("Choose a protocol.");
    if (!starts || !ends) return setError("Set a valid time window.");
    if (![baseCents, maxCents, budgetCents].every(Number.isFinite)) return setError("Prices and budget must be numbers.");
    setBusy(true);
    try {
      const r = await api.createBounty({
        protocol_id: protocolId,
        title,
        summary,
        center_lat: center.lat,
        center_lng: center.lng,
        radius_m: radius,
        starts_at: starts,
        ends_at: ends,
        event_started_at: eventIso,
        base_price_cents: baseCents,
        max_price_cents: maxCents,
        target_per_cell: target,
        priority,
        budget_cents: budgetCents,
        sponsor_name: sponsorName.trim() || null,
        sponsor_url: sponsorUrl.trim() || null,
        status: "active",
        source: "manual",
      });
      router.push(`/bounties/${r.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const overBudget = Number.isFinite(budgetCents) && preview.maxExposureCents > budgetCents;

  return (
    <>
      <PageHeader
        title="New bounty"
        description="Click the map to set the center; the radius slider previews coverage cells and live prices."
        actions={
          <Link href="/bounties" className={buttonVariants({ variant: "ghost" })}>
            <ArrowLeft aria-hidden /> Bounties
          </Link>
        }
      />
      <form onSubmit={(e) => void onSubmit(e)} className="grid flex-1 gap-0 lg:grid-cols-[1fr_400px]">
        <div className="relative min-h-[420px]">
          <HexMap
            center={center}
            zoom={13.5}
            cells={preview.cells}
            circle={{ ...center, radiusM: radius }}
            marker={center}
            onMapClick={(lat, lng) => setCenter({ lat, lng })}
            cursor="crosshair"
            className="absolute inset-0"
          />
          <div className="absolute bottom-3 left-3">
            <MapLegend showPaused={false} />
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto border-l bg-card p-5">
          <Card className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle>Live price preview</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <Stat label="Cells" value={cells.length} sub="H3 res 9" />
              <Stat
                label="Per cell now"
                value={formatCents(preview.priceCents)}
                sub={
                  <Badge tone={isHotSurge(preview.surge) ? "warning" : "muted"}>{formatSurge(preview.surge)} surge</Badge>
                }
              />
              <Stat label="Max exposure" value={formatCents(preview.maxExposureCents)} sub="cells × target × price" />
              {overBudget ? (
                <p className="col-span-3 flex items-center gap-1.5 text-xs text-amber-800">
                  <TriangleAlert className="size-3.5" aria-hidden /> Budget runs out before every cell reaches target;
                  sessions stop when it&apos;s spent.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Field label="Protocol" htmlFor="protocol">
            <Select id="protocol" value={protocolId} onChange={(e) => setProtocolId(e.target.value)} required>
              {protocols.loading ? <option>Loading…</option> : null}
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (v{p.version}
                  {p.status === "draft" ? ", draft" : ""})
                </option>
              ))}
            </Select>
          </Field>
          <ErrorBox message={protocols.error} />

          <Field label="Title" htmlFor="title">
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} required />
          </Field>
          <Field label="Summary" htmlFor="summary">
            <Textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} />
          </Field>

          <Field
            label={`Radius: ${radius >= 1000 ? `${(radius / 1000).toFixed(2)} km` : `${radius} m`}`}
            htmlFor="radius"
            hint={`Center ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`}
          >
            <input
              id="radius"
              type="range"
              min={RADIUS_MIN}
              max={RADIUS_MAX}
              step={50}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="starts">
              <Input id="starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
            </Field>
            <Field label="Ends" htmlFor="ends">
              <Input id="ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
            </Field>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasEvent} onChange={(e) => setHasEvent(e.target.checked)} className="size-4" />
              Triggering event already started (urgency pricing)
            </label>
            {hasEvent ? (
              <Input type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} aria-label="Event start" />
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Base price ($)" htmlFor="base">
              <Input id="base" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} required />
            </Field>
            <Field label="Max price ($)" htmlFor="max">
              <Input id="max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} required />
            </Field>
            <Field label="Target per cell" htmlFor="target">
              <Input
                id="target"
                type="number"
                min={1}
                max={100}
                value={target}
                onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
                required
              />
            </Field>
            <Field label={`Priority ×${priority.toFixed(1)}`} htmlFor="priority">
              <input
                id="priority"
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="mt-2 w-full accent-[var(--color-primary)]"
              />
            </Field>
            <Field label="Total budget ($)" htmlFor="budget" className="col-span-2">
              <Input id="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} required />
            </Field>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              Sponsors fund collection; the resulting dataset is published free for everyone (CC BY 4.0, no images).
            </p>
            <Field label="Sponsor (optional)" htmlFor="sponsor">
              <Input id="sponsor" value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} maxLength={120} placeholder="e.g. City Stormwater Office" />
            </Field>
            <Field label="Sponsor link (optional)" htmlFor="sponsor-url">
              <Input id="sponsor-url" type="url" value={sponsorUrl} onChange={(e) => setSponsorUrl(e.target.value)} maxLength={300} placeholder="https://" />
            </Field>
          </div>

          <ErrorBox message={error} />
          <Button type="submit" size="lg" className="w-full" disabled={busy || !protocolId}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Publish bounty
          </Button>
        </div>
      </form>
    </>
  );
}
