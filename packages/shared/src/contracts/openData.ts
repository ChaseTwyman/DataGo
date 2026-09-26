import { z } from "zod";
import { IsoDate, Uuid } from "./common";

/**
 * Open data (no login). Every published protocol's accepted observations form one public dataset.
 * Structured data only — photos are never published (bystander privacy, PRD §13). Public rows are
 * coarsened (see OPEN_DATA_COARSENING); researcher exports under /api/bounties/:id/export stay full-fidelity.
 */

/** One place to switch the license (e.g. to CC0). */
export const OPEN_DATA_LICENSE = {
  id: "CC-BY-4.0",
  short_name: "CC BY 4.0",
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "GroundTruth contributors",
} as const;

/** Human-readable statement of how public rows differ from the raw observations. */
export const OPEN_DATA_COARSENING = [
  "Location is snapped to the center of the H3 resolution-9 cell (about 0.1 km², edge ~175 m) that contains the capture point; h3_cell is kept.",
  "GPS accuracy is reported as a bucket (gps_accuracy_bucket), never as the raw value.",
  "captured_at is rounded down to the start of its 5-minute window (UTC). Server receive time is not published.",
  "contributor_id is a per-dataset pseudonym: rows by the same person link within this dataset, but not across datasets or back to app accounts.",
  "observation_id is a pseudonym, not the internal submission id.",
  "Phone model, contributor trust score, and free-text fields are withheld. Images are never published.",
] as const;

export const PublicDatasetFormatSchema = z.enum(["csv", "geojson", "json", "dictionary"]);
export type PublicDatasetFormat = z.infer<typeof PublicDatasetFormatSchema>;

// GET /api/public/datasets/:slug?format=&bounty_id=&limit=
export const PublicDatasetQuerySchema = z.object({
  format: PublicDatasetFormatSchema.default("csv"),
  bounty_id: Uuid.optional(),
  /** Only for format=json (the /data page previews the first rows). */
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type PublicDatasetQuery = z.infer<typeof PublicDatasetQuerySchema>;

export const OpenDataLicenseSchema = z.object({
  id: z.string(),
  short_name: z.string(),
  name: z.string(),
  url: z.string(),
  attribution: z.string(),
});

export const PublicSponsorSchema = z.object({ name: z.string(), url: z.string().nullable() });
export type PublicSponsor = z.infer<typeof PublicSponsorSchema>;

export const PublicDatasetBountySchema = z.object({
  id: Uuid,
  title: z.string(),
  sponsor_name: z.string().nullable(),
  sponsor_url: z.string().nullable(),
  rows: z.number().int().min(0),
});

export const PublicCellCountSchema = z.object({ h3_cell: z.string(), rows: z.number().int().min(1) });

export const CitationSchema = z.object({ text: z.string(), bibtex: z.string() });

export const PublicDatasetSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  version: z.number().int(),
  description: z.string(),
  rows: z.number().int().min(0),
  contributors: z.number().int().min(0),
  /** [min_lng, min_lat, max_lng, max_lat] over the published (cell-center) points; null when empty. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  time_range: z.object({ start: IsoDate, end: IsoDate }).nullable(),
  last_updated: IsoDate.nullable(),
  /** True when some rows are demo/seed rows (see the is_demo_seed column). */
  includes_demo_rows: z.boolean(),
  sponsors: z.array(PublicSponsorSchema),
  bounties: z.array(PublicDatasetBountySchema),
  cells: z.array(PublicCellCountSchema),
  license: OpenDataLicenseSchema,
  citation: CitationSchema,
  downloads: z.object({ csv: z.string(), geojson: z.string(), json: z.string(), dictionary: z.string() }),
});
export type PublicDatasetSummary = z.infer<typeof PublicDatasetSummarySchema>;

// GET /api/public/datasets
export const PublicDatasetListResponseSchema = z.object({
  generated_at: IsoDate,
  license: OpenDataLicenseSchema,
  datasets: z.array(PublicDatasetSummarySchema),
});
export type PublicDatasetListResponse = z.infer<typeof PublicDatasetListResponseSchema>;

export const PublicCellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const PublicRowSchema = z.record(z.string(), PublicCellValueSchema);
export type PublicRow = z.infer<typeof PublicRowSchema>;

export const PublicColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
  source: z.enum(["provenance", "extraction", "field_note", "verification"]),
});
export type PublicColumn = z.infer<typeof PublicColumnSchema>;

// format=json
export const PublicDatasetJsonResponseSchema = z.object({
  dataset: z.object({ slug: z.string(), name: z.string(), version: z.number().int() }),
  license: OpenDataLicenseSchema,
  bounty_id: Uuid.nullable(),
  total_rows: z.number().int().min(0),
  columns: z.array(z.string()),
  rows: z.array(PublicRowSchema),
});
export type PublicDatasetJsonResponse = z.infer<typeof PublicDatasetJsonResponseSchema>;

// format=dictionary
export const PublicDictionaryResponseSchema = z.object({
  dataset: z.object({ slug: z.string(), name: z.string(), version: z.number().int() }),
  license: OpenDataLicenseSchema,
  license_statement: z.string(),
  citation: CitationSchema,
  coarsening: z.array(z.string()),
  provenance: z.array(z.string()),
  columns: z.array(PublicColumnSchema),
});
export type PublicDictionaryResponse = z.infer<typeof PublicDictionaryResponseSchema>;
