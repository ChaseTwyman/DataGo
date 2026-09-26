"use client";
import { ArrowLeft, LoaderCircle, Radar, TriangleAlert } from "lucide-react";
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
import { api, errorMessage, fieldErrors } from "@/lib/client/api";
import { fieldErrorSummary } from "@/lib/client/errors";
import { dollarsToCents, isoToLocalInput, localInputToIso, previewPrices } from "@/lib/client/pricePreview";
import { FORM_RADIUS_MAX as RADIUS_MAX, FORM_RADIUS_MIN as RADIUS_MIN, parseBountyPrefill, pickProtocolId, zoomForRadiusM, type BountyPrefill } from "@/lib/client/radar";
import { useApi } from "@/lib/client/useApi";

/** Fields rendered with their own inline message; others are summarized above the submit button. */
const INLINE_FIELDS = new Set(["protocol_id", "title", "summary", "radius_m", "starts_at", "ends_at", "base_price_cents", "max_price_cents", "target_per_cell", "budget_cents", "sponsor_name", "sponsor_url"]);

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
  const [fields, setFields] = useState<Record<string, string>>({});
  // Prefill from the URL: ?protocol=<id> (Protocol Studio) or a whole Opportunity Radar draft
  // (lib/client/radar.ts draftPrefillHref). Read on mount, directly from window.location, so the page
  // needs no Suspense boundary for useSearchParams. The researcher reviews and publishes; nothing
  // is created from the URL alone.
  const [prefill, setPrefill] = useState<BountyPrefill | null>(null);
  useEffect(() => {
    const p = parseBountyPrefill(window.location.search);
    if (!p) return;
    setPrefill(p);
    if (p.title) setTitle(p.title);
    if (p.summary !== null) setSummary(p.summary);
    if (p.center) setCenter(p.center);
    if (p.radiusM !== null) setRadius(p.radiusM);
  }, []);

  const list = protocols.data?.protocols ?? [];
  useEffect(() => {
    if (protocolId || !list[0]) return;
    setProtocolId(pickProtocolId(list, { protocolId: prefill?.protocolId ?? null, protocolSlug: prefill?.protocolSlug ?? null }));
  }, [list, protocolId, prefill]);
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
    setFields({});
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
        source: prefill?.source ?? "manual",
      });
      router.push(`/bounties/${r.id}`);
    } catch (err) {
      // Validation failures (client-side zod or a server 400/422) go next to the fields they concern.
      const fe = fieldErrors(err);
      setFields(fe);
      const offForm = Object.fromEntries(Object.entries(fe).filter(([k]) => !INLINE_FIELDS.has(k)));
      setError(
        Object.keys(fe).length
          ? ["Some fields need attention.", fieldErrorSummary(offForm)].filter(Boolean).join(" ")
          : errorMessage(err),
      );
      setBusy(false);
    }
  };

  const overBudget = Number.isFinite(budgetCents) && preview.maxExposureCents > budgetCents;
  const radarSlugMissing =
    prefill?.source === "radar" && !!prefill.protocolSlug && list.length > 0 && !list.some((p) => p.slug === prefill.protocolSlug && p.status === "published");

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
            zoom={prefill?.radiusM ? Math.min(13.5, zoomForRadiusM(prefill.radiusM)) : 13.5}
            cells={preview.cells}
            circle={{ ...center, radiusM: radius }}
            marker={center}
            onMapClick={(lat, lng) => setCenter({ lat, lng })}
            flyKey={prefill?.center ? "prefill" : undefined}
            cursor="crosshair"
            className="absolute inset-0"
          />
          <div className="absolute bottom-3 left-3">
            <MapLegend showPaused={false} />
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto border-l bg-card p-5">
          {prefill?.source === "radar" ? (
            <div role="note" className="space-y-1 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
              <div className="flex items-center gap-1.5 font-medium">
                <Radar className="size-4" aria-hidden /> Drafted by Opportunity Radar
                {prefill.alertEvent ? <Badge tone="warning">{prefill.alertEvent}</Badge> : null}
              </div>
              <p className="text-xs text-sky-900/80">
                Title, summary, area and protocol come from the AI draft. Check every field, set prices and budget, then publish — nothing is
                created until you do.
              </p>
              {radarSlugMissing ? (
                <p className="text-xs text-amber-800">
                  The drafted protocol ({prefill.protocolSlug}) isn&apos;t available to you; choose a protocol below.
                </p>
              ) : null}
            </div>
          ) : null}
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

          <Field label="Protocol" htmlFor="protocol" error={fields.protocol_id}>
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

          <Field label="Title" htmlFor="title" error={fields.title}>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} required />
          </Field>
          <Field label="Summary" htmlFor="summary" error={fields.summary}>
            <Textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} />
          </Field>

          <Field
            label={`Radius: ${radius >= 1000 ? `${(radius / 1000).toFixed(2)} km` : `${radius} m`}`}
            htmlFor="radius"
            error={fields.radius_m}
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
            <Field label="Starts" htmlFor="starts" error={fields.starts_at}>
              <Input id="starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
            </Field>
            <Field label="Ends" htmlFor="ends" error={fields.ends_at}>
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
            <Field label="Base price ($)" htmlFor="base" error={fields.base_price_cents}>
              <Input id="base" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} required />
            </Field>
            <Field label="Max price ($)" htmlFor="max" error={fields.max_price_cents}>
              <Input id="max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} required />
            </Field>
            <Field label="Target per cell" htmlFor="target" error={fields.target_per_cell}>
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
            <Field label="Total budget ($)" htmlFor="budget" className="col-span-2" error={fields.budget_cents}>
              <Input id="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} required />
            </Field>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              Sponsors fund collection; the resulting dataset is published free for everyone (CC BY 4.0, no images).
            </p>
            <Field label="Sponsor (optional)" htmlFor="sponsor" error={fields.sponsor_name}>
              <Input id="sponsor" value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} maxLength={120} placeholder="e.g. City Stormwater Office" />
            </Field>
            <Field label="Sponsor link (optional)" htmlFor="sponsor-url" error={fields.sponsor_url}>
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
