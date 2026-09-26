"use client";
import { ArrowRight, CloudLightning, ExternalLink, LoaderCircle, MapPin, Radar, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEMO, type DraftBounty } from "@groundtruth/shared";
import { HexMap } from "@/components/map";
import { Slider } from "@/components/ds/controls";
import { JobProgress } from "@/components/ds/primitives";
import { Empty, ErrorBox, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { api } from "@/lib/client/api";
import {
  clearRadarJob,
  draftPrefillHref,
  getRadarJob,
  radarErrorMessage,
  radarStage,
  safeSourceLinks,
  startRadarJob,
  subscribeRadarJob,
  zoomForRadiusM,
  type RadarJob,
} from "@/lib/client/radar";
import { useApi } from "@/lib/client/useApi";

const RADIUS_KM_MIN = 5;
const RADIUS_KM_MAX = 300;
/** A scan usually finishes within this; the bar fills toward it (the model doesn't stream progress). */
const EXPECTED_MS = 150_000;

export default function RadarPage() {
  const job = useSyncExternalStore(subscribeRadarJob, getRadarJob, getRadarJob);
  const bounties = useApi(() => api.bounties(), "radar:bounties");

  // Region: a running/finished scan's region wins so coming back shows what was scanned.
  const initial = job.status === "idle" ? { lat: DEMO.lat, lng: DEMO.lng, radius_km: 25 } : job.request;
  const [center, setCenter] = useState({ lat: initial.lat, lng: initial.lng });
  const [radiusKm, setRadiusKm] = useState(initial.radius_km);
  const [latText, setLatText] = useState(initial.lat.toFixed(4));
  const [lngText, setLngText] = useState(initial.lng.toFixed(4));
  const [fly, setFly] = useState(0);

  const moveTo = (lat: number, lng: number, recenter: boolean) => {
    setCenter({ lat, lng });
    setLatText(lat.toFixed(4));
    setLngText(lng.toFixed(4));
    if (recenter) setFly((n) => n + 1);
  };

  const typedLat = Number(latText);
  const typedLng = Number(lngText);
  const typedValid = latText.trim() !== "" && lngText.trim() !== "" && Math.abs(typedLat) <= 90 && Math.abs(typedLng) <= 180;

  const running = job.status === "running";
  const scan = () => {
    if (!typedValid) return;
    const req = { lat: typedLat, lng: typedLng, radius_km: radiusKm };
    setCenter({ lat: req.lat, lng: req.lng });
    startRadarJob(req, (r) => api.radarScan(r), radarErrorMessage);
  };

  const myBounties = bounties.data?.bounties ?? [];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Radar className="size-6 text-primary" strokeWidth={1.5} aria-hidden /> Opportunity Radar
          </span>
        }
        description="Scan a region for active weather alerts and recent reports. Grok drafts bounties where ground-truth data would be scarce and valuable; you review and publish."
      />
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="relative min-h-[380px] bg-[#0c0c0c] lg:min-h-[480px]">
          <HexMap
            center={center}
            zoom={zoomForRadiusM(radiusKm * 1000)}
            circle={{ ...center, radiusM: radiusKm * 1000 }}
            marker={center}
            onMapClick={(lat, lng) => moveTo(lat, lng, false)}
            flyKey={fly ? String(fly) : undefined}
            cursor="crosshair"
            className="absolute inset-0"
          />
          <p className="caps pointer-events-none absolute top-3 left-3 rounded-sm border bg-black/80 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur-sm">
            Click the map to move the scan center
          </p>
        </div>

        <div className="space-y-5 border-l bg-card p-5">
          <Field label="Start from one of your bounties" htmlFor="bounty-center" hint="Uses that bounty's center.">
            <Select
              id="bounty-center"
              value=""
              disabled={running || !myBounties.length}
              onChange={(e) => {
                const b = myBounties.find((x) => x.id === e.target.value);
                if (b) moveTo(b.center_lat, b.center_lng, true);
              }}
            >
              <option value="">{bounties.loading ? "Loading…" : myBounties.length ? "Choose a bounty…" : "No bounties yet"}</option>
              {myBounties.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" htmlFor="lat">
              <Input
                id="lat"
                inputMode="decimal"
                value={latText}
                disabled={running}
                onChange={(e) => setLatText(e.target.value)}
                onBlur={() => typedValid && moveTo(typedLat, typedLng, true)}
              />
            </Field>
            <Field label="Longitude" htmlFor="lng">
              <Input
                id="lng"
                inputMode="decimal"
                value={lngText}
                disabled={running}
                onChange={(e) => setLngText(e.target.value)}
                onBlur={() => typedValid && moveTo(typedLat, typedLng, true)}
              />
            </Field>
          </div>
          {!typedValid ? <p className="text-xs text-destructive" role="alert">Enter a latitude between -90 and 90 and a longitude between -180 and 180.</p> : null}

          <Field label={`Radius: ${radiusKm} km`} htmlFor="radius" hint="Weather alerts are National Weather Service (US only).">
            <Slider
              id="radius"
              min={RADIUS_KM_MIN}
              max={RADIUS_KM_MAX}
              step={5}
              value={radiusKm}
              disabled={running}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              onPointerUp={() => setFly((n) => n + 1)}
              onKeyUp={() => setFly((n) => n + 1)}
            />
          </Field>

          <Button size="lg" className="w-full" disabled={running || !typedValid} onClick={scan}>
            {running ? <LoaderCircle className="animate-spin" aria-hidden /> : <Radar aria-hidden />}
            {running ? "Scanning…" : "Scan for opportunities"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Each scan runs a live search with Grok and can take a few minutes. Nothing is published automatically.
          </p>
        </div>
      </div>

      <div className="space-y-4 border-t p-6">
        <ScanStatus job={job} onRetry={scan} />
        {job.status === "done" ? <Results job={job} /> : null}
        {job.status === "idle" ? (
          <Empty title="No scan yet">Pick a region and press &quot;Scan for opportunities&quot;. Drafted bounties appear here for your review.</Empty>
        ) : null}
      </div>
    </>
  );
}

function ScanStatus({ job, onRetry }: { job: RadarJob; onRetry: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  if (job.status === "running") {
    const elapsed = Math.max(0, now - job.startedAt);
    return (
      <JobProgress stage={radarStage(elapsed)} pct={Math.min(95, (elapsed / EXPECTED_MS) * 100)}>
        {Math.round(elapsed / 1000)} s · usually 1–3 minutes for {job.request.radius_km} km around {job.request.lat.toFixed(3)}, {job.request.lng.toFixed(3)}. You can
        leave this page; the results will be here when you come back.
      </JobProgress>
    );
  }
  if (job.status === "error") return <ErrorBox message={job.message} onRetry={onRetry} />;
  return null;
}

function Results({ job }: { job: Extract<RadarJob, { status: "done" }> }) {
  const { drafts, alerts_considered: alerts } = job.result;
  const events = useMemo(() => [...new Set(drafts.map((d) => d.alert_event).filter((e): e is string => !!e))], [drafts]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <CloudLightning className="size-4 text-warning" strokeWidth={1.75} aria-hidden />
          <span className="font-medium">
            {alerts === 0 ? "No active weather alerts" : `${alerts} active weather alert${alerts === 1 ? "" : "s"}`} considered
          </span>
          {events.map((e) => (
            <Badge key={e} tone="warning">
              {e}
            </Badge>
          ))}
          <span className="text-muted-foreground">
            · {job.request.radius_km} km around {job.request.lat.toFixed(3)}, {job.request.lng.toFixed(3)} · {new Date(job.finishedAt).toLocaleTimeString()}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={clearRadarJob}>
          <RotateCcw aria-hidden /> Clear results
        </Button>
      </div>

      {drafts.length === 0 ? (
        alerts === 0 ? (
          <Empty title="No active weather alerts in this area — try a wider radius">
            Grok also found no recent reports worth a bounty here right now.
          </Empty>
        ) : (
          <Empty title="No bounty worth drafting right now">
            There are active alerts, but Grok found no place that is both safe and short on ground-truth data. Try again later or scan a wider area.
          </Empty>
        )
      ) : (
        <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {drafts.map((d, i) => (
            <DraftCard key={`${d.title}-${i}`} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ d }: { d: DraftBounty }) {
  const links = safeSourceLinks(d.sources);
  const center = { lat: d.center_lat, lng: d.center_lng };
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative h-44 border-b">
        <HexMap center={center} zoom={zoomForRadiusM(d.radius_m)} circle={{ ...center, radiusM: d.radius_m }} marker={center} className="absolute inset-0" />
      </div>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="info">Draft · not published</Badge>
          {d.alert_event ? <Badge tone="warning">{d.alert_event}</Badge> : <Badge tone="muted">No NWS alert</Badge>}
        </div>
        <CardTitle className="text-base">{d.title}</CardTitle>
        <CardDescription className="flex items-center gap-1 font-mono text-[11px]">
          <MapPin className="size-3" aria-hidden />
          {d.center_lat.toFixed(4)}, {d.center_lng.toFixed(4)} · {d.radius_m >= 1000 ? `${(d.radius_m / 1000).toFixed(1)} km` : `${Math.round(d.radius_m)} m`} ·{" "}
          {d.protocol_slug}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        <p>{d.summary}</p>
        <div>
          <div className="caps text-[10px] text-muted-foreground">Why here, why now</div>
          <p className="mt-0.5 text-muted-foreground">{d.rationale}</p>
        </div>
        {links.length ? (
          <div>
            <div className="caps text-[10px] text-muted-foreground">Sources</div>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {links.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                    title={l.href}
                  >
                    {l.label} <ExternalLink className="size-3" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No sources cited — check the situation yourself before publishing.</p>
        )}
        <div className="mt-auto pt-1">
          <Link href={draftPrefillHref(d)} className={buttonVariants({ className: "w-full" })}>
            Review &amp; create <ArrowRight aria-hidden />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
