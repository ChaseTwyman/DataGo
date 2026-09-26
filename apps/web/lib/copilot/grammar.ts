/**
 * The Ask-the-data grammar: which public columns a plan may name, and the validator every plan
 * (model-written, cached, or mock) passes before anything touches the database.
 *
 * The catalogue is derived from publicColumns(protocol) — the exact column set the open-data API
 * publishes — so the copilot can never name a column the public dataset doesn't already have. It is
 * further restricted to fields that make sense to filter/aggregate: extraction fields and enum or
 * boolean field notes (free text is already withheld by publicColumns), plus a few verification
 * columns. contributor_id, observation ids, bounty ids, device fields are never in the catalogue.
 */
import { COPILOT_MAX_LIMIT, COPILOT_REFUSAL, CopilotPlanSchema, type CopilotAggFn, type CopilotPlan, type Protocol } from "@groundtruth/shared";
import { publicColumns } from "../openData";

export type FieldKind = "number" | "enum" | "boolean";

export interface CatalogueField {
  name: string;
  kind: FieldKind;
  /** enum only */
  options: string[];
  description: string;
  source: "extraction" | "field_note" | "verification";
}

export interface Catalogue {
  slug: string;
  fields: CatalogueField[];
}

/** Verification columns a researcher may reasonably filter or aggregate on. */
const VERIFICATION_FIELDS = new Set(["confidence", "protocol_score", "authenticity_score", "human_reviewed", "gps_accuracy_bucket"]);

/** Strict identifier shape; every name that reaches SQL must also be in the catalogue. */
export const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;

function kindOf(type: string): { kind: FieldKind; options: string[] } | null {
  const t = type.trim();
  const m = /^enum\(([^)]*)\)/.exec(t);
  if (m) {
    const options = (m[1] ?? "").split("|").map((s) => s.trim()).filter(Boolean);
    return options.length ? { kind: "enum", options } : null;
  }
  const base = t.split(",")[0]!.trim();
  if (base === "number" || base === "integer" || base === "number|integer") return { kind: "number", options: [] };
  if (base === "boolean") return { kind: "boolean", options: [] };
  return null; // strings, uuids, datetimes: not in the grammar
}

export function buildCatalogue(slug: string, protocol: Protocol): Catalogue {
  const fields: CatalogueField[] = [];
  for (const c of publicColumns(protocol)) {
    const allowed =
      c.source === "extraction" || c.source === "field_note" || (c.source === "verification" && VERIFICATION_FIELDS.has(c.name)) || c.name === "gps_accuracy_bucket";
    if (!allowed || !IDENT_RE.test(c.name)) continue;
    const k = kindOf(c.type);
    if (!k) continue;
    const source = c.source === "provenance" ? "verification" : c.source;
    fields.push({ name: c.name, kind: k.kind, options: k.options, description: c.description.slice(0, 160), source });
  }
  return { slug, fields };
}

export const fieldOf = (cat: Catalogue, name: string | null | undefined): CatalogueField | undefined =>
  name ? cat.fields.find((f) => f.name === name) : undefined;

export const aggAlias = (fn: CopilotAggFn, field: string | null): string => (fn === "count" && !field ? "count" : `${fn}_${field}`);

/** Group key column name in the result. */
export function groupAlias(plan: Pick<CopilotPlan, "group_by">): string | null {
  const g = plan.group_by;
  if (g.kind === "none") return null;
  if (g.kind === "field") return g.field;
  return g.kind;
}

export interface ValidateContext {
  catalogue: Catalogue;
  /** Bounties of this dataset the caller may scope to. */
  allowedBountyIds: string[];
  /** Coverage vs target is for signed-in researchers on their own bounties only. */
  allowCoverage: boolean;
  now: Date;
}

export type Validated = { ok: true; plan: CopilotPlan } | { ok: false; reason: string };

const refuse = (reason: string): Validated => ({ ok: false, reason });

const BOOL = new Set(["true", "false"]);

/**
 * Validates and normalises a plan. Anything unknown (field, op/type mismatch, enum value outside
 * the schema, limit, bounty not allowed) is a refusal, never a best-effort guess. Returns a NEW
 * plan object (defaults filled, chart coerced) — the caller uses only that.
 */
export function validatePlan(raw: unknown, ctx: ValidateContext): Validated {
  // strict: an unknown top-level key (e.g. "sql") is a refusal, not silently dropped.
  const parsed = CopilotPlanSchema.strict().safeParse(raw);
  if (!parsed.success) return refuse("The question could not be turned into a supported query.");
  const p: CopilotPlan = structuredClone(parsed.data);
  if (!p.answerable) return refuse(COPILOT_REFUSAL);
  const cat = ctx.catalogue;
  if (p.dataset !== cat.slug) return refuse("That dataset is not available here.");

  // time
  if (p.time.since_hours !== null && (p.time.from !== null || p.time.to !== null)) return refuse("Use either a relative or an absolute time window, not both.");
  for (const k of ["from", "to"] as const) {
    const v = p.time[k];
    if (v !== null && !Number.isFinite(Date.parse(v))) return refuse("The time window is not a valid date.");
    if (v !== null) p.time[k] = new Date(Date.parse(v)).toISOString();
  }
  if (p.time.from && p.time.to && Date.parse(p.time.from) >= Date.parse(p.time.to)) return refuse("The time window ends before it starts.");

  // place
  if (p.near) {
    const { lat, lng, radius_m } = p.near;
    if (![lat, lng, radius_m].every(Number.isFinite)) return refuse("The place filter is not valid.");
    p.near.label = p.near.label.replace(/[^\p{L}\p{N} ,.'()-]/gu, "").trim().slice(0, 80) || "the given point";
  }

  if (p.bounty_id !== null && !ctx.allowedBountyIds.includes(p.bounty_id)) return refuse("That bounty is not part of the data you can query.");

  // field filters
  for (const f of p.filters) {
    const field = fieldOf(cat, f.field);
    if (!field) return refuse(`"${safe(f.field)}" is not a published column of this dataset.`);
    const why = checkFilter(field, f);
    if (why) return refuse(why);
  }

  // coverage
  if (p.coverage !== "none") {
    if (!ctx.allowCoverage) return refuse("Coverage against targets is available to signed-in researchers for their own requests.");
    if (!p.bounty_id) return refuse("Coverage against targets needs a specific request (bounty).");
    p.group_by = { kind: "h3_cell", field: null };
    p.aggregates = [{ fn: "count", field: null }];
    if (p.chart !== "table") p.chart = "map";
  }

  // grouping
  if (p.group_by.kind === "field") {
    const g = fieldOf(cat, p.group_by.field);
    if (!g) return refuse(`"${safe(p.group_by.field ?? "")}" is not a published column of this dataset.`);
    if (g.kind === "number") return refuse("Grouping works on categories (like surface type), not on measured numbers.");
  } else {
    p.group_by.field = null;
  }

  // aggregates
  const seen = new Set<string>();
  const aggs: CopilotPlan["aggregates"] = [];
  for (const a of p.aggregates) {
    if (a.fn === "count") {
      if (a.field !== null && !fieldOf(cat, a.field)) return refuse(`"${safe(a.field)}" is not a published column of this dataset.`);
    } else {
      const f = fieldOf(cat, a.field);
      if (!f) return refuse(`"${safe(a.field ?? "")}" is not a published column of this dataset.`);
      if (f.kind !== "number") return refuse(`${a.fn} needs a numeric column; "${f.name}" is not numeric.`);
    }
    const alias = aggAlias(a.fn, a.field);
    if (seen.has(alias)) continue;
    seen.add(alias);
    aggs.push({ fn: a.fn, field: a.field });
  }
  if (p.group_by.kind !== "none" && aggs.length === 0) aggs.push({ fn: "count", field: null });
  p.aggregates = aggs;

  // limit + sort
  p.limit = Math.min(Math.max(1, Math.trunc(p.limit)), COPILOT_MAX_LIMIT);
  const outputs = outputColumns(p, cat);
  if (p.sort) {
    if (!outputs.includes(p.sort.by)) return refuse(`Can't sort by "${safe(p.sort.by)}": it is not in the result.`);
  } else {
    p.sort = defaultSort(p, cat);
  }

  // chart: only what the result shape supports
  p.chart = coerceChart(p);
  return { ok: true, plan: p };
}

function checkFilter(field: CatalogueField, f: CopilotPlan["filters"][number]): string | null {
  const needsValue = f.op !== "is_null" && f.op !== "not_null" && f.op !== "in";
  if (needsValue && f.value === null) return `The filter on ${field.name} has no value.`;
  if (f.op === "in" && f.values.length === 0) return `The filter on ${field.name} lists no values.`;
  if (f.op === "lt" || f.op === "lte" || f.op === "gt" || f.op === "gte") {
    if (field.kind !== "number") return `"${field.name}" is not numeric, so it can't be compared with < or >.`;
  }
  const vals = f.op === "in" ? f.values : needsValue ? [f.value!] : [];
  for (const v of vals) {
    if (field.kind === "number" && !(/^-?\d{1,9}(\.\d{1,6})?$/.test(v.trim()) && Number.isFinite(Number(v)))) return `"${safe(v)}" is not a number (${field.name}).`;
    if (field.kind === "boolean" && !BOOL.has(v.toLowerCase())) return `${field.name} is yes/no (true or false).`;
    if (field.kind === "enum" && !field.options.includes(v)) return `"${safe(v)}" is not a value of ${field.name} (${field.options.join(", ")}).`;
  }
  return null;
}

/** Result column names for a plan (sort targets). */
export function outputColumns(p: CopilotPlan, cat: Catalogue): string[] {
  if (p.coverage !== "none") return ["h3_cell", "observations", "target"];
  const g = groupAlias(p);
  if (g !== null || p.aggregates.length > 0) return [...(g ? [g] : []), ...p.aggregates.map((a) => aggAlias(a.fn, a.field))];
  return rowColumns(p, cat);
}

/** Row-mode columns: base + every extraction field + any other field the plan references. */
export function rowColumns(p: CopilotPlan, cat: Catalogue): string[] {
  const referenced = new Set<string>([...p.filters.map((f) => f.field)]);
  if (p.sort) referenced.add(p.sort.by);
  const fields = cat.fields.filter((f) => f.source === "extraction" || referenced.has(f.name)).map((f) => f.name);
  return ["observation_id", "captured_at", "h3_cell", "lat", "lng", "quality_tier", ...fields];
}

function defaultSort(p: CopilotPlan, cat: Catalogue): NonNullable<CopilotPlan["sort"]> {
  if (p.coverage !== "none") return { by: "observations", dir: "asc" };
  const g = groupAlias(p);
  if (g === "hour" || g === "day") return { by: g, dir: "asc" };
  if (g !== null || p.aggregates.length) {
    const first = p.aggregates[0]!;
    return { by: aggAlias(first.fn, first.field), dir: "desc" };
  }
  void cat;
  return { by: "captured_at", dir: "desc" };
}

function coerceChart(p: CopilotPlan): CopilotPlan["chart"] {
  const g = groupAlias(p);
  if (p.group_by.kind === "h3_cell") return p.chart === "table" || p.chart === "bar" ? p.chart : "map";
  if (g === "hour" || g === "day") return p.chart === "table" || p.chart === "bar" ? p.chart : "line";
  if (g !== null) return p.chart === "table" ? "table" : "bar";
  if (p.aggregates.length) return "table";
  return p.chart === "map" ? "map" : "table";
}

/** A name echoed back in a refusal: short, no markup. */
function safe(s: string): string {
  return s.replace(/[^\w .-]/g, "").slice(0, 40);
}
