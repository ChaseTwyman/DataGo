/**
 * Opportunity Radar client helpers (PRD §7.6). Pure except the scan-job store.
 *
 * A scan is one grok-4.7 call with x_search + web_search and can take minutes. The request lives in a
 * module-level job (like Protocol Studio's draft job) so the researcher can leave /radar and come
 * back to the progress or the result. Nothing is created automatically: each draft links to
 * /bounties/new with the fields pre-filled, and the researcher publishes from there.
 */
import type { DraftBounty } from "@groundtruth/shared";
import { ApiClientError, errorMessage } from "./errors";

// ---------------------------------------------------------------- scan job

export interface RadarRequest {
  lat: number;
  lng: number;
  radius_km: number;
}
export interface RadarResult {
  drafts: DraftBounty[];
  alerts_considered: number;
}

export type RadarJob =
  | { status: "idle" }
  | { status: "running"; request: RadarRequest; startedAt: number }
  | { status: "done"; request: RadarRequest; result: RadarResult; finishedAt: number }
  | { status: "error"; request: RadarRequest; message: string };

let job: RadarJob = { status: "idle" };
const listeners = new Set<() => void>();

export function getRadarJob(): RadarJob {
  return job;
}

function setJob(j: RadarJob): void {
  job = j;
  for (const l of listeners) l();
}

export function subscribeRadarJob(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Starts a scan unless one is running (each scan costs a paid model call). */
export function startRadarJob(request: RadarRequest, run: (r: RadarRequest) => Promise<RadarResult>, describe: (e: unknown) => string): boolean {
  if (job.status === "running") return false;
  setJob({ status: "running", request, startedAt: Date.now() });
  run(request).then(
    (result) => setJob({ status: "done", request, result, finishedAt: Date.now() }),
    (e: unknown) => setJob({ status: "error", request, message: describe(e) }),
  );
  return true;
}

export function clearRadarJob(): void {
  if (job.status !== "running") setJob({ status: "idle" });
}

/** Progress copy by elapsed time (the model doesn't stream progress). */
export function radarStage(elapsedMs: number): string {
  const s = elapsedMs / 1000;
  if (s < 10) return "Checking active National Weather Service alerts…";
  if (s < 45) return "Searching recent X posts and news about local conditions…";
  if (s < 100) return "Weighing where ground-truth data is scarce and safe to collect…";
  if (s < 180) return "Drafting bounties with sources…";
  return "Still searching. Wide areas with many reports take longer.";
}

/** Radar-specific wording on top of the shared error copy. */
export function radarErrorMessage(e: unknown): string {
  // The route may run up to 4 minutes; a platform timeout answers 504 with no JSON body.
  if (e instanceof ApiClientError && e.status === 504) {
    return "The scan took too long and was stopped. Try a smaller radius, or scan again in a minute.";
  }
  return errorMessage(e);
}

// ---------------------------------------------------------------- map

/** Zoom that fits a circle of `radiusM` in a ~300 px tall map (256 px Web Mercator tiles). */
export function zoomForRadiusM(radiusM: number): number {
  const z = Math.log2((156_543 * 150) / Math.max(radiusM, 1));
  return Math.min(16, Math.max(3, Math.round(z * 10) / 10));
}

// ---------------------------------------------------------------- sources

/** Model-written URLs are untrusted: keep only unique http(s) links, labeled by host. */
export function safeSourceLinks(sources: readonly string[]): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    let u: URL;
    try {
      u = new URL(s.trim());
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({ href: u.href, label: u.hostname.replace(/^www\./, "") });
  }
  return out;
}

// ---------------------------------------------------------------- draft → New bounty form

/** Bounds of the New bounty form (its radius slider and CreateBountyRequestSchema). */
export const FORM_RADIUS_MIN = 100;
export const FORM_RADIUS_MAX = 5000;
const RADIUS_STEP = 50;
const TITLE_MAX = 120;
const SUMMARY_MAX = 500;

export interface BountyPrefill {
  title: string | null;
  summary: string | null;
  center: { lat: number; lng: number } | null;
  radiusM: number | null;
  protocolSlug: string | null;
  protocolId: string | null;
  source: "radar" | "manual";
  alertEvent: string | null;
}

export function draftPrefillHref(d: DraftBounty): string {
  const q = new URLSearchParams({
    source: "radar",
    title: d.title,
    summary: d.summary,
    lat: String(d.center_lat),
    lng: String(d.center_lng),
    radius: String(Math.round(d.radius_m)),
    protocol_slug: d.protocol_slug,
  });
  if (d.alert_event) q.set("alert", d.alert_event);
  return `/bounties/new?${q.toString()}`;
}

function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v: string | null, max: number): string | null {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Query string → values for the New bounty form, validated and clamped to what the form accepts.
 * null when the URL carries nothing to prefill. Anything invalid is dropped (the form's default
 * stays), never trusted: this URL can be edited by hand.
 */
export function parseBountyPrefill(search: string): BountyPrefill | null {
  const q = new URLSearchParams(search);
  const lat = num(q.get("lat"));
  const lng = num(q.get("lng"));
  const center = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  const r = num(q.get("radius"));
  const radiusM = r === null ? null : Math.min(FORM_RADIUS_MAX, Math.max(FORM_RADIUS_MIN, Math.round(r / RADIUS_STEP) * RADIUS_STEP));
  const p: BountyPrefill = {
    title: text(q.get("title"), TITLE_MAX),
    summary: text(q.get("summary"), SUMMARY_MAX),
    center,
    radiusM,
    protocolSlug: text(q.get("protocol_slug"), 200),
    protocolId: text(q.get("protocol"), 200),
    source: q.get("source") === "radar" ? "radar" : "manual",
    alertEvent: text(q.get("alert"), 200),
  };
  const any = p.title || p.summary || p.center || p.radiusM !== null || p.protocolSlug || p.protocolId || p.source === "radar";
  return any ? p : null;
}

interface ProtocolChoice {
  id: string;
  slug: string;
  version: number;
  status: string;
}

/** Explicit published id → newest published version of the slug → first in the list. */
export function pickProtocolId(list: readonly ProtocolChoice[], want: { protocolId: string | null; protocolSlug: string | null }): string {
  const published = list.filter((p) => p.status === "published");
  const byId = published.find((p) => p.id === want.protocolId);
  if (byId) return byId.id;
  const bySlug = published.filter((p) => p.slug === want.protocolSlug).sort((a, b) => b.version - a.version)[0];
  if (bySlug) return bySlug.id;
  return published[0]?.id ?? list[0]?.id ?? "";
}
