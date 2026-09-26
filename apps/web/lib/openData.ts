/**
 * Open data (no login): one public dataset per published protocol, across all its bounties.
 *
 * Public rows are the researcher export (lib/export.ts) passed through `coarsen`, which is the ONLY
 * place privacy is applied — every public format (CSV, GeoJSON, JSON) goes through it:
 *   - lat/lng → centre of the H3 res-9 cell (h3_cell kept); accuracy_m → a bucket
 *   - captured_at floored to 5 minutes; received_at, device_model, contributor_trust dropped
 *   - contributor_id → sha256(salt:slug:user) (links within a dataset only); observation_id → pseudonym
 *   - free-text fields withheld (they can name addresses); media never selected (images stay private)
 * Publishing rule (vitamin-water incident follow-up): a row is public only if it is accepted AND
 * (verifier = human, or verifier = model with confidence ≥ 0.75), i.e. it has a quality_tier.
 * mock/none rows (MOCK_GROK decisions, demo/seed tooling) are never published. Enforced twice: the
 * SQL filter below and qualityTier() over every row.
 */
import { createHash } from "node:crypto";
import {
  cellCenter,
  qualityTier,
  OPEN_DATA_COARSENING,
  OPEN_DATA_LICENSE,
  type Protocol,
  type PublicDatasetSummary,
  type PublicSponsor,
} from "@groundtruth/shared";
import type { Db } from "./db";
import { getProtocolBySlug, type ProtocolRow } from "./db/repos/protocols";
import { dataDictionary, flattenExportRow, isUnpublishable, type ColumnDef, type ExportRow } from "./export";

export const TIME_BIN_MINUTES = 5;
/** device.model values written by demo/seed tooling (lib/demo.ts, lib/openDataSeed.ts). */
export const DEMO_DEVICE_MODELS = ["demo-seed", "seed-script"] as const;

/** verifier is implied by quality_tier (only model/human rows are public). */
const DROPPED = new Set(["accuracy_m", "received_at", "device_model", "contributor_trust", "verifier"]);

const OVERRIDES: Record<string, Pick<ColumnDef, "type" | "description">> = {
  observation_id: { type: "string", description: "Pseudonymous observation id (16 hex chars); not the internal submission id." },
  lat: { type: "number", description: "Latitude (WGS84) of the centre of the H3 res-9 cell containing the capture point (coarsened)." },
  lng: { type: "number", description: "Longitude (WGS84) of the centre of the H3 res-9 cell containing the capture point (coarsened)." },
  captured_at: { type: "datetime", description: `Capture time (ISO 8601, UTC), rounded down to the start of its ${TIME_BIN_MINUTES}-minute window.` },
  revisit_of: {
    type: "string, nullable",
    description: "Pseudonymous observation_id of the first reading at the same cell when this reading answered a revisit mission (a time series at one spot, e.g. flood recession).",
  },
  contributor_id: {
    type: "string",
    description: "Per-dataset contributor pseudonym (16 hex chars): the same person has the same id within this dataset, a different id in other datasets, and it cannot be mapped back to an app account.",
  },
};

const ADDED_AFTER: Record<string, ColumnDef> = {
  h3_cell: {
    name: "gps_accuracy_bucket",
    type: "enum(le_10m|le_30m|le_100m|gt_100m|unknown)",
    description: "Reported GPS horizontal accuracy, bucketed (the raw value is not published).",
    source: "provenance",
  },
  frame_count: {
    name: "is_demo_seed",
    type: "boolean",
    description: "Always false: demo/seed rows created by GroundTruth tooling are never published. Kept for schema compatibility.",
    source: "provenance",
  },
};

/** Free text can name an address or a person, so it is never published. */
function isFreeText(c: ColumnDef, protocol: Protocol): boolean {
  if (c.source === "extraction") {
    const field = Object.keys(protocol.extraction_schema.properties).find((f) => c.name === f || c.name === `extracted_${f}`);
    const schema = field ? protocol.extraction_schema.properties[field] : undefined;
    const t = schema?.type;
    const types = Array.isArray(t) ? t : [t];
    return types.includes("string") && !Array.isArray(schema?.enum);
  }
  if (c.source === "field_note") {
    const q = protocol.capture.field_questions.find((x) => `note_${x.id}` === c.name);
    return q?.type === "text";
  }
  return false;
}

export function publicColumns(protocol: Protocol): ColumnDef[] {
  const out: ColumnDef[] = [];
  for (const c of dataDictionary(protocol)) {
    if (DROPPED.has(c.name) || isFreeText(c, protocol)) continue;
    const o = OVERRIDES[c.name];
    out.push(o ? { ...c, ...o } : c);
    const added = ADDED_AFTER[c.name];
    if (added) out.push(added);
  }
  return out;
}

const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
export const contributorPseudonym = (salt: string, slug: string, userId: string) => sha16(`${salt}:${slug}:${userId}`);
export const observationPseudonym = (salt: string, slug: string, id: string) => sha16(`${salt}:obs:${slug}:${id}`);

export function floorToBin(iso: string, minutes = TIME_BIN_MINUTES): string {
  const ms = minutes * 60_000;
  return new Date(Math.floor(Date.parse(iso) / ms) * ms).toISOString();
}

export function accuracyBucket(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return "unknown";
  if (m <= 10) return "le_10m";
  if (m <= 30) return "le_30m";
  if (m <= 100) return "le_100m";
  return "gt_100m";
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Full-fidelity export row → public row, restricted to `columns` (so nothing unlisted can leak). */
export function coarsen(row: ExportRow, salt: string, slug: string, columns: ColumnDef[]): ExportRow {
  const center = cellCenter(String(row.h3_cell));
  const derived: ExportRow = {
    ...row,
    observation_id: observationPseudonym(salt, slug, String(row.observation_id)),
    lat: round6(center.lat),
    lng: round6(center.lng),
    captured_at: floorToBin(String(row.captured_at)),
    contributor_id: contributorPseudonym(salt, slug, String(row.contributor_id)),
    revisit_of: row.revisit_of ? observationPseudonym(salt, slug, String(row.revisit_of)) : null,
    gps_accuracy_bucket: accuracyBucket(typeof row.accuracy_m === "number" ? row.accuracy_m : null),
    is_demo_seed: (DEMO_DEVICE_MODELS as readonly string[]).includes(String(row.device_model)),
  };
  const out: ExportRow = {};
  for (const c of columns) out[c.name] = derived[c.name] ?? null;
  return out;
}

const saltCache = new WeakMap<Db, string>();

export async function publicDatasetSalt(db: Db): Promise<string> {
  const cached = saltCache.get(db);
  if (cached) return cached;
  const rows = await db.query<{ value: string }>("select value from public.app_settings where key = 'public_dataset_salt'");
  const salt = rows[0]?.value;
  if (!salt) throw new Error("public_dataset_salt missing: apply migration 20260926000004_open_data.sql");
  saltCache.set(db, salt);
  return salt;
}

export async function publishedSlugs(db: Db): Promise<string[]> {
  const rows = await db.query<{ slug: string }>("select distinct slug from public.protocols where status = 'published' order by slug");
  return rows.map((r) => r.slug);
}

export async function loadPublishedProtocol(db: Db, slug: string): Promise<ProtocolRow | null> {
  return getProtocolBySlug(db, slug);
}

/** Public rows for one dataset (all bounties of the protocol slug, or one bounty), oldest first. */
export async function publicRows(db: Db, protocol: ProtocolRow, opts: { bountyId?: string } = {}): Promise<ExportRow[]> {
  const params: string[] = [protocol.slug];
  let where = "protocol_slug = $1";
  if (opts.bountyId) {
    params.push(opts.bountyId);
    where += " and bounty_id = $2";
  }
  // Explicit columns: media is not in the view, and nothing else is selected by accident.
  const raw = await db.query<Record<string, unknown>>(
    `select observation_id, bounty_id, protocol_slug, protocol_version, lat, lng, accuracy_m, h3_cell, captured_at,
            received_at, confidence, protocol_score, authenticity_score, extracted, field_notes, reason_codes,
            contributor_id, contributor_trust, device_model, device_os, frame_count, gate_degraded, human_reviewed,
            verifier, quality_tier,
            (select s.revisit_of from public.submissions s where s.id = observation_id) as revisit_of
       from public.observations_export
      where ${where} and quality_tier is not null and verifier not in ('mock', 'none')`,
    params,
  );
  const salt = await publicDatasetSalt(db);
  const columns = publicColumns(protocol.definition);
  const publishable = raw.filter(
    (r) => !isUnpublishable(r.verifier) && qualityTier("accepted", String(r.verifier), r.confidence === null ? null : Number(r.confidence)) !== null,
  );
  const rows = publishable.map((r) => coarsen(flattenExportRow(r, protocol.definition), salt, protocol.slug, columns));
  // Sort on public values only, so row order leaks nothing finer than the 5-minute bin.
  return rows.sort(
    (a, b) => String(a.captured_at).localeCompare(String(b.captured_at)) || String(a.observation_id).localeCompare(String(b.observation_id)),
  );
}

export interface DatasetBounty {
  id: string;
  title: string;
  sponsor_name: string | null;
  sponsor_url: string | null;
}

/** Non-draft bounties of a protocol slug (any version), for sponsor credit. */
export async function datasetBounties(db: Db, slug: string): Promise<DatasetBounty[]> {
  return db.query<DatasetBounty>(
    `select b.id, b.title, b.sponsor_name, b.sponsor_url
       from public.bounties b join public.protocols p on p.id = b.protocol_id
      where p.slug = $1 and b.status <> 'draft'
      order by b.created_at`,
    [slug],
  );
}

export function licenseStatement(): string {
  return `Licensed under ${OPEN_DATA_LICENSE.name} (${OPEN_DATA_LICENSE.id}, ${OPEN_DATA_LICENSE.url}). Attribute as "${OPEN_DATA_LICENSE.attribution}".`;
}

export function citation(protocol: ProtocolRow, origin: string, lastUpdated: string | null, now = new Date()): { text: string; bibtex: string } {
  const year = (lastUpdated ? new Date(lastUpdated) : now).getUTCFullYear();
  const accessed = now.toISOString().slice(0, 10);
  const url = `${origin}/data#${protocol.slug}`;
  const text =
    `${OPEN_DATA_LICENSE.attribution}. (${year}). ${protocol.name} (Version ${protocol.version}) [Data set]. GroundTruth. ` +
    `${url}. Licensed under ${OPEN_DATA_LICENSE.short_name}. Accessed ${accessed}.`;
  const key = `groundtruth_${protocol.slug.replace(/-/g, "_")}_${year}`;
  const bibtex = [
    `@misc{${key},`,
    `  author       = {{${OPEN_DATA_LICENSE.attribution}}},`,
    `  title        = {{${protocol.name}}},`,
    `  year         = {${year}},`,
    `  version      = {${protocol.version}},`,
    `  publisher    = {GroundTruth},`,
    `  howpublished = {\\url{${url}}},`,
    `  note         = {License: ${OPEN_DATA_LICENSE.id}. Accessed ${accessed}.}`,
    `}`,
  ].join("\n");
  return { text, bibtex };
}

export const PROVENANCE_NOTES = [
  "Each row is one accepted observation: captured in-app under a published protocol, inside a bounty area and time window, with a server-issued nonce and a timed burst challenge.",
  "Rows passed automated verification (session integrity, server-side capture gate, subject relevance, image quality, authenticity incl. C2PA/AI-generation labels, duplicate and velocity checks, weather/daylight context, protocol compliance, extraction sanity) with confidence ≥ 0.75 (quality_tier = model_high), or were approved by a human reviewer (quality_tier = human_verified).",
  "Extracted values (e.g. depth) are model estimates from the images; see confidence and protocol_score. note_* columns are the contributor's own spoken answers.",
  "Photos are not published (bystander privacy). Synthetic/generated media is stored separately and can never be attached to an observation.",
  "Demo/seed rows and rows decided by mock (test) verification are never published.",
] as const;

export function dictionaryBody(protocol: ProtocolRow, origin: string) {
  return {
    dataset: { slug: protocol.slug, name: protocol.name, version: protocol.version },
    license: { ...OPEN_DATA_LICENSE },
    license_statement: licenseStatement(),
    citation: citation(protocol, origin, null),
    coarsening: [...OPEN_DATA_COARSENING],
    provenance: [...PROVENANCE_NOTES],
    columns: publicColumns(protocol.definition),
  };
}

export async function datasetSummary(db: Db, protocol: ProtocolRow, origin: string): Promise<PublicDatasetSummary> {
  const [rows, bounties] = await Promise.all([publicRows(db, protocol), datasetBounties(db, protocol.slug)]);
  const lats = rows.map((r) => Number(r.lat));
  const lngs = rows.map((r) => Number(r.lng));
  const times = rows.map((r) => String(r.captured_at));
  const perBounty = new Map<string, number>();
  const perCell = new Map<string, number>();
  for (const r of rows) {
    perBounty.set(String(r.bounty_id), (perBounty.get(String(r.bounty_id)) ?? 0) + 1);
    perCell.set(String(r.h3_cell), (perCell.get(String(r.h3_cell)) ?? 0) + 1);
  }
  const sponsors: PublicSponsor[] = [];
  for (const b of bounties) {
    if (b.sponsor_name && !sponsors.some((s) => s.name === b.sponsor_name)) sponsors.push({ name: b.sponsor_name, url: b.sponsor_url });
  }
  const last = times.length ? times[times.length - 1]! : null;
  const base = `/api/public/datasets/${protocol.slug}`;
  return {
    slug: protocol.slug,
    name: protocol.name,
    version: protocol.version,
    description: protocol.definition.why_it_matters,
    rows: rows.length,
    contributors: new Set(rows.map((r) => r.contributor_id)).size,
    bbox: rows.length ? [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] : null,
    time_range: rows.length ? { start: times[0]!, end: last! } : null,
    last_updated: last,
    includes_demo_rows: rows.some((r) => r.is_demo_seed === true),
    tiers: {
      human_verified: rows.filter((r) => r.quality_tier === "human_verified").length,
      model_high: rows.filter((r) => r.quality_tier === "model_high").length,
    },
    sponsors,
    bounties: bounties.map((b) => ({ ...b, rows: perBounty.get(b.id) ?? 0 })),
    cells: [...perCell.entries()].map(([h3_cell, n]) => ({ h3_cell, rows: n })).sort((a, b) => b.rows - a.rows),
    license: { ...OPEN_DATA_LICENSE },
    citation: citation(protocol, origin, last),
    downloads: {
      csv: `${base}?format=csv`,
      geojson: `${base}?format=geojson`,
      json: `${base}?format=json`,
      dictionary: `${base}?format=dictionary`,
    },
  };
}

export const PUBLIC_CACHE_HEADERS = {
  "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  "access-control-allow-origin": "*",
} as const;
