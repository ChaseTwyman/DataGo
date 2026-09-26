/**
 * Dataset export (PRD §7.7): accepted observations from the `observations_export` view, with the
 * protocol's extraction fields flattened into columns and a data dictionary generated from the
 * extraction schema. No media paths or URLs are exported (raw images stay private), so synthetic
 * media cannot leak here by construction; submissions can't hold synthetic paths anyway (DB trigger).
 */
import type { Protocol } from "@groundtruth/shared";
import type { Db } from "./db";
import { toIso } from "./db/types";

export interface ColumnDef {
  name: string;
  type: string;
  description: string;
  source: "provenance" | "extraction" | "field_note" | "verification";
}

const BASE: ColumnDef[] = [
  { name: "observation_id", type: "uuid", description: "Unique id of the accepted observation.", source: "provenance" },
  { name: "bounty_id", type: "uuid", description: "Bounty the observation was captured for.", source: "provenance" },
  { name: "protocol_slug", type: "string", description: "Protocol identifier.", source: "provenance" },
  { name: "protocol_version", type: "integer", description: "Protocol version.", source: "provenance" },
  { name: "lat", type: "number", description: "Latitude (WGS84) reported by the phone at capture.", source: "provenance" },
  { name: "lng", type: "number", description: "Longitude (WGS84) reported by the phone at capture.", source: "provenance" },
  { name: "accuracy_m", type: "number", description: "Reported GPS horizontal accuracy, meters.", source: "provenance" },
  { name: "h3_cell", type: "string", description: "H3 cell (resolution 9) containing the point.", source: "provenance" },
  { name: "captured_at", type: "datetime", description: "Capture time (ISO 8601, UTC).", source: "provenance" },
  { name: "received_at", type: "datetime", description: "Server receive time (ISO 8601, UTC).", source: "provenance" },
  { name: "confidence", type: "number", description: "Blended verification confidence 0..1 (protocol, authenticity, context, reputation).", source: "verification" },
  { name: "protocol_score", type: "number", description: "Model-assessed protocol compliance 0..1.", source: "verification" },
  { name: "authenticity_score", type: "number", description: "Model-assessed authenticity 0..1.", source: "verification" },
  { name: "reason_codes", type: "string", description: "Informational verification codes, ';'-separated (e.g. DEMO_WAIVER).", source: "verification" },
  { name: "human_reviewed", type: "boolean", description: "True if a reviewer approved it from the review queue.", source: "verification" },
  { name: "gate_degraded", type: "boolean", description: "True if the capture gate ran on device checks only.", source: "verification" },
  { name: "contributor_id", type: "uuid", description: "Pseudonymous contributor id.", source: "provenance" },
  { name: "contributor_trust", type: "number", description: "Contributor trust score 0..1 at export time.", source: "provenance" },
  { name: "device_model", type: "string", description: "Phone model.", source: "provenance" },
  { name: "device_os", type: "string", description: "Phone OS.", source: "provenance" },
  { name: "frame_count", type: "integer", description: "Frames in the challenge burst.", source: "provenance" },
];

function typeOf(schema: Record<string, unknown>): string {
  const t = schema.type;
  const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
  const nonNull = types.filter((x) => x !== "null");
  let out = nonNull.join("|") || "any";
  if (Array.isArray(schema.enum)) out = `enum(${schema.enum.join("|")})`;
  return types.includes("null") ? `${out}, nullable` : out;
}

export function extractionColumnName(field: string): string {
  return BASE.some((c) => c.name === field) ? `extracted_${field}` : field;
}

export function dataDictionary(protocol: Protocol): ColumnDef[] {
  const extraction = Object.entries(protocol.extraction_schema.properties).map(([field, s]) => {
    const schema = s as Record<string, unknown>;
    const desc = typeof schema.description === "string" ? schema.description : `Extracted ${field.replace(/_/g, " ")}.`;
    return { name: extractionColumnName(field), type: typeOf(schema), description: `${desc} Estimated by the verification model.`, source: "extraction" as const };
  });
  const notes = protocol.capture.field_questions.map((q) => ({
    name: `note_${q.id}`,
    type: q.type === "enum" ? `enum(${q.options.join("|")})` : q.type,
    description: `Contributor's spoken answer: "${q.question}"`,
    source: "field_note" as const,
  }));
  return [...BASE, ...extraction, ...notes];
}

export type ExportRow = Record<string, string | number | boolean | null>;

export async function exportRows(db: Db, bountyId: string, protocol: Protocol): Promise<ExportRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select * from public.observations_export where bounty_id = $1 order by captured_at`,
    [bountyId],
  );
  const extractionFields = Object.keys(protocol.extraction_schema.properties);
  return rows.map((r) => {
    const extracted = (r.extracted ?? {}) as Record<string, unknown>;
    const notes = (r.field_notes ?? {}) as Record<string, unknown>;
    const out: ExportRow = {
      observation_id: String(r.observation_id),
      bounty_id: String(r.bounty_id),
      protocol_slug: String(r.protocol_slug),
      protocol_version: Number(r.protocol_version),
      lat: Number(r.lat),
      lng: Number(r.lng),
      accuracy_m: r.accuracy_m === null ? null : Number(r.accuracy_m),
      h3_cell: String(r.h3_cell),
      captured_at: toIso(r.captured_at),
      received_at: toIso(r.received_at),
      confidence: r.confidence === null ? null : Number(r.confidence),
      protocol_score: r.protocol_score === null ? null : Number(r.protocol_score),
      authenticity_score: r.authenticity_score === null ? null : Number(r.authenticity_score),
      reason_codes: ((r.reason_codes as string[] | null) ?? []).join(";"),
      human_reviewed: Boolean(r.human_reviewed),
      gate_degraded: r.gate_degraded === null ? null : Boolean(r.gate_degraded),
      contributor_id: String(r.contributor_id),
      contributor_trust: r.contributor_trust === null ? null : Number(r.contributor_trust),
      device_model: (r.device_model as string | null) ?? null,
      device_os: (r.device_os as string | null) ?? null,
      frame_count: Number(r.frame_count),
    };
    for (const f of extractionFields) out[extractionColumnName(f)] = scalar(extracted[f]);
    for (const q of protocol.capture.field_questions) out[`note_${q.id}`] = scalar(notes[q.id]);
    return out;
  });
}

function scalar(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

export function toCsv(columns: string[], rows: ExportRow[]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Neutralise spreadsheet formulas from contributor-controlled text (device model, field notes).
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export function toGeoJson(rows: ExportRow[]) {
  return {
    type: "FeatureCollection" as const,
    features: rows.map((r) => ({
      type: "Feature" as const,
      id: r.observation_id,
      geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] },
      properties: r,
    })),
  };
}
