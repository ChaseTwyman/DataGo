"use client";
import { ArrowLeft, LoaderCircle, Radar } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { cellsForCircle, DEMO, formatCents, formatSurge, isHotSurge, type CellPrice, type PricingPreviewResponse } from "@groundtruth/shared";
import { Notice, Panel, PanelHeader, Readout } from "@/components/ds/primitives";
import { HexMap, MapLegend } from "@/components/map";
import { ErrorBox, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage, fieldErrors } from "@/lib/client/api";
import { fieldErrorSummary } from "@/lib/client/errors";
import { isoToLocalInput, localInputToIso } from "@/lib/client/pricePreview";
import { FORM_RADIUS_MAX as RADIUS_MAX, FORM_RADIUS_MIN as RADIUS_MIN, parseBountyPrefill, pickProtocolId, zoomForRadiusM, type BountyPrefill } from "@/lib/client/radar";
import { useApi } from "@/lib/client/useApi";

/** Fields rendered with their own inline message; others are summarized above the submit button. */
const INLINE_FIELDS = new Set(["protocol_id", "title", "summary", "radius_m", "starts_at", "ends_at", "target_per_cell", "justification"]);
const PREVIEW_DEBOUNCE_MS = 400;

/**
 * New data request. Researchers say WHAT they need (protocol, area, window, readings per cell, why);
 * the platform funds it from the sponsor pool and prices every cell with its own engine. The price
 * preview comes from POST /api/pricing/preview — no pricing logic runs in the browser.
 */
export default function NewRequestPage() {
  const router = useRouter();
  const protocols = useApi(() => api.protocols(), "protocols");

  const now = useMemo(() => new Date(), []);
  const [protocolId, setProtocolId] = useState("");
  const [title, setTitle] = useState("Flash flood: street depth");
  const [summary, setSummary] = useState("Street-level flood depth readings to calibrate the city flood model.");
  const [justification, setJustification] = useState("");
  const [center, setCenter] = useState<{ lat: number; lng: number }>({ lat: DEMO.lat, lng: DEMO.lng });
  const [radius, setRadius] = useState<number>(DEMO.radiusM);
  const [startsAt, setStartsAt] = useState(isoToLocalInput(now));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(new Date(now.getTime() + 24 * 3_600_000)));
  const [hasEvent, setHasEvent] = useState(true);
  const [eventAt, setEventAt] = useState(isoToLocalInput(new Date(now.getTime() - 30 * 60_000)));
  const [target, setTarget] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  // Prefill from the URL: ?protocol=<id> (Protocol Studio) or a whole Opportunity Radar draft
  // (lib/client/radar.ts draftPrefillHref). Nothing is created from the URL alone.
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

  const cells = useMemo(() => cellsForCircle(center.lat, center.lng, radius), [center, radius]);
  const eventIso = hasEvent ? localInputToIso(eventAt) : null;
  const startsIso = localInputToIso(startsAt);
  const endsIso = localInputToIso(endsAt);

  // Server-side price preview, debounced; the last good preview stays on screen while the next loads.
  const [preview, setPreview] = useState<PricingPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    if (!protocolId || !startsIso || !endsIso || Date.parse(endsIso) <= Date.parse(startsIso)) return;
    let alive = true;
    const t = setTimeout(() => {
      setPreviewing(true);
      api
        .pricingPreview({
          protocol_id: protocolId,
          center_lat: center.lat,
          center_lng: center.lng,
          radius_m: radius,
          target_per_cell: target,
          starts_at: startsIso,
          ends_at: endsIso,
          event_started_at: eventIso,
        })
        .then((p) => {
          if (!alive) return;
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e: unknown) => alive && setPreviewError(errorMessage(e)))
        .finally(() => alive && setPreviewing(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [protocolId, center, radius, target, startsIso, endsIso, eventIso]);

  // Until the first preview arrives, show the cells unpriced.
  const mapCells: CellPrice[] = useMemo(
    () =>
      preview && preview.cells.length === cells.length
        ? preview.cells
        : cells.map((cell) => ({ cell, accepted: 0, target, price_cents: 0, surge: 1, paused: false, paused_reason: null })),
    [preview, cells, target],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!protocolId) return setError("Choose a protocol.");
    if (!startsIso || !endsIso) return setError("Set a valid time window.");
    setBusy(true);
    try {
      const r = await api.createBounty({
        protocol_id: protocolId,
        title,
        summary,
        center_lat: center.lat,
        center_lng: center.lng,
        radius_m: radius,
        starts_at: startsIso,
        ends_at: endsIso,
        event_started_at: eventIso,
        target_per_cell: target,
        justification: justification.trim(),
        source: prefill?.source ?? "manual",
      });
      router.push(`/bounties/${r.id}`);
    } catch (err) {
      const fe = fieldErrors(err);
      setFields(fe);
      const offForm = Object.fromEntries(Object.entries(fe).filter(([k]) => !INLINE_FIELDS.has(k)));
      setError(
        Object.keys(fe).length ? ["Some fields need attention.", fieldErrorSummary(offForm)].filter(Boolean).join(" ") : errorMessage(err),
      );
      setBusy(false);
    }
  };

  const radarSlugMissing =
    prefill?.source === "radar" && !!prefill.protocolSlug && list.length > 0 && !list.some((p) => p.slug === prefill.protocolSlug && p.status === "published");

  return (
    <>
      <PageHeader
        eyebrow="Data request"
        title="New request"
        description="Say what data you need. GroundTruth funds requests from its sponsor pool and sets every price with its pricing engine."
        actions={
          <Link href="/bounties" className={buttonVariants({ variant: "ghost" })}>
            <ArrowLeft aria-hidden /> Bounties
          </Link>
        }
      />
      <form onSubmit={(e) => void onSubmit(e)} className="grid flex-1 gap-0 lg:grid-cols-[1fr_420px]">
        <div className="relative min-h-[420px]">
          <HexMap
            center={center}
            zoom={prefill?.radiusM ? Math.min(13.5, zoomForRadiusM(prefill.radiusM)) : 13.5}
            cells={mapCells}
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
            <Notice tone="info" title={<span className="flex items-center gap-1.5"><Radar className="size-3.5" aria-hidden /> Drafted by Opportunity Radar</span>}>
              Title, summary, area and protocol come from the AI draft{prefill.alertEvent ? ` (${prefill.alertEvent})` : ""}. Check every field, then
              submit — nothing is created until you do.
              {radarSlugMissing ? ` The drafted protocol (${prefill.protocolSlug}) isn't available to you; choose a protocol below.` : ""}
            </Notice>
          ) : null}

          <Panel>
            <PanelHeader
              title="Platform price preview"
              actions={previewing ? <LoaderCircle className="size-3.5 animate-spin" aria-label="Updating" /> : "live"}
            />
            <div className="grid grid-cols-3 gap-4 p-4">
              <Readout size="sm" label="Cells" value={cells.length} sub="H3 res 9" />
              <Readout
                size="sm"
                label="Per reading"
                value={preview ? formatCents(preview.price_cents) : "—"}
                sub={
                  preview ? (
                    <Badge tone={isHotSurge(preview.surge) ? "warning" : "muted"}>{formatSurge(preview.surge)} surge</Badge>
                  ) : (
                    "median cell"
                  )
                }
              />
              <Readout size="sm" label="Est. cost" value={preview ? formatCents(preview.estimated_need_cents) : "—"} sub="to fill every cell" />
            </div>
            {preview ? (
              <div className="space-y-3 border-t px-4 py-3 text-xs text-muted-foreground">
                <p>
                  Range {formatCents(preview.min_price_cents)}–{formatCents(preview.max_price_cents)} per reading now (base{" "}
                  {formatCents(preview.base_cents)}, ceiling {formatCents(preview.ceiling_cents)}). Prices move with coverage, event age,
                  demand, nearby activity and pacing.
                </p>
                {preview.price_reasons.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {preview.price_reasons.map((r) => (
                      <Badge key={r} tone="muted">
                        {r}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {preview.funding.would_fund ? (
                  <Notice tone="info" title="Fundable now">
                    The sponsor pool would allocate {formatCents(preview.funding.allocation_cents)} when you submit.
                  </Notice>
                ) : (
                  <Notice tone="warning" title="Would wait for funding">
                    {preview.funding.reason ?? "The request would wait for funding."}
                  </Notice>
                )}
              </div>
            ) : null}
            <ErrorBox message={previewError} className="m-4 mt-0" />
          </Panel>

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
          <Field label="Summary (shown to contributors)" htmlFor="summary" error={fields.summary}>
            <Textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Why is this data needed?" htmlFor="justification" error={fields.justification} hint="Seen by the admins who approve funding.">
            <Textarea
              id="justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Calibrating the city's flood model for the Oct 1 storm; readings go into the public dataset."
            />
          </Field>

          <Field
            label={`Radius: ${radius >= 1000 ? `${(radius / 1000).toFixed(2)} km` : `${radius} m`}`}
            htmlFor="radius"
            error={fields.radius_m}
            hint={`Center ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)} — click the map to move it`}
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

          <Field label="Readings wanted per cell" htmlFor="target" error={fields.target_per_cell}>
            <Input id="target" type="number" min={1} max={100} value={target} onChange={(e) => setTarget(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} required />
          </Field>

          <div className="space-y-2 border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasEvent} onChange={(e) => setHasEvent(e.target.checked)} className="size-4" />
              A triggering event already started (optional)
            </label>
            {hasEvent ? <Input type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} aria-label="Event start" /> : null}
          </div>

          <ErrorBox message={error} />
          <Button type="submit" size="lg" className="w-full" disabled={busy || !protocolId}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Submit request
          </Button>
          <p className="text-xs text-muted-foreground">
            Money is simulated. Sponsors fund the pool; the resulting dataset is published free for everyone (CC BY 4.0, no images).
          </p>
        </div>
      </form>
    </>
  );
}
