/**
 * Validated plan → parameterized SQL over the coarsened public rows.
 *
 * The rows are NOT read from a table here: the caller passes the exact rows the open-data API
 * serves (lib/openData.ts publicRows → coarsen), with contributor_id removed, as ONE jsonb bind
 * parameter that `jsonb_to_recordset` turns into a typed relation. So the query can only ever see
 * public, coarsened values (cell-centre coordinates, 5-minute times, pseudonymous observation ids),
 * and no user id is even present in the input.
 *
 * Injection: every value in the plan is a bind parameter ($n). Identifiers come only from the
 * catalogue (itself derived from the protocol's public columns), are re-checked against IDENT_RE
 * and double-quoted. Operators, aggregate functions and sort directions come from fixed maps keyed
 * by enum values. Nothing from the question or the plan is concatenated into the SQL text.
 */
import type { CopilotColumn, CopilotPlan, CopilotResult, PublicRow } from "@groundtruth/shared";
import type { Db } from "../db";
import type { SqlParam } from "../db/types";
import type { ExportRow } from "../export";
import { aggAlias, fieldOf, groupAlias, IDENT_RE, rowColumns, type Catalogue, type CatalogueField } from "./grammar";

export interface CompiledQuery {
  /** Main query: result rows (+ __total window column). */
  text: string;
  /** Count of filtered observations. */
  countText: string;
  params: SqlParam[];
  columns: CopilotColumn[];
}

export function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`invalid identifier: ${name.slice(0, 40)}`);
  return `"${name}"`;
}

const OPS: Record<string, string> = { eq: "=", neq: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" };
const AGG: Record<string, (col: string) => string> = {
  min: (c) => `round(min(${c})::numeric, 2)::float8`,
  max: (c) => `round(max(${c})::numeric, 2)::float8`,
  mean: (c) => `round(avg(${c})::numeric, 2)::float8`,
  median: (c) => `round((percentile_cont(0.5) within group (order by ${c}))::numeric, 2)::float8`,
  p90: (c) => `round((percentile_cont(0.9) within group (order by ${c}))::numeric, 2)::float8`,
};
const SQL_TYPE: Record<CatalogueField["kind"], string> = { number: "float8", enum: "text", boolean: "boolean" };

/** Fixed base columns of the recordset. */
const BASE_COLS: [string, string][] = [
  ["observation_id", "text"],
  ["h3_cell", "text"],
  ["lat", "float8"],
  ["lng", "float8"],
  ["captured_at", "timestamptz"],
  ["quality_tier", "text"],
];

const ISO_MINUTE = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

class Params {
  readonly list: SqlParam[] = [];
  add(v: SqlParam): string {
    this.list.push(v);
    return `$${this.list.length}`;
  }
}

/** Only the columns the recordset declares; contributor_id and anything else is dropped here. */
export function recordsetRows(rows: ExportRow[], cat: Catalogue): Record<string, unknown>[] {
  const keep = [...BASE_COLS.map(([n]) => n), ...cat.fields.map((f) => f.name)];
  return rows.map((r) => Object.fromEntries(keep.map((k) => [k, r[k] ?? null])));
}

function columnType(name: string, cat: Catalogue): CopilotColumn["type"] {
  if (name === "captured_at" || name === "hour" || name === "day") return "datetime";
  if (name === "lat" || name === "lng" || name === "observations" || name === "target" || name === "count") return "number";
  const f = fieldOf(cat, name);
  if (f) return f.kind === "number" ? "number" : f.kind === "boolean" ? "boolean" : "string";
  if (/^(count|min|max|mean|median|p90)_/.test(name)) return "number";
  return "string";
}

const LABEL_FN: Record<string, string> = { count: "Count", min: "Min", max: "Max", mean: "Mean", median: "Median", p90: "90th pct" };
function columnLabel(name: string): string {
  const m = /^(count|min|max|mean|median|p90)_(.+)$/.exec(name);
  if (m) return `${LABEL_FN[m[1]!]} ${m[2]!.replace(/_/g, " ")}`;
  return name.replace(/_/g, " ");
}

/**
 * Compiles a VALIDATED plan (validatePlan). `rowsJson` is the recordset payload; `now` anchors
 * relative windows; `coverage` supplies the bounty's cells and per-cell target for coverage plans.
 */
export function compilePlan(
  plan: CopilotPlan,
  cat: Catalogue,
  rowsJson: string,
  now: Date,
  coverage?: { cells: string[]; target: number },
): CompiledQuery {
  const P = new Params();
  const rowsParam = P.add(rowsJson);
  const decl = [...BASE_COLS, ...cat.fields.map((f): [string, string] => [f.name, SQL_TYPE[f.kind]])]
    .map(([n, t]) => `${ident(n)} ${t}`)
    .join(", ");

  const where: string[] = [];
  const t = plan.time;
  if (t.since_hours !== null) where.push(`captured_at >= ${P.add(new Date(now.getTime() - t.since_hours * 3_600_000).toISOString())}::timestamptz`);
  if (t.from) where.push(`captured_at >= ${P.add(t.from)}::timestamptz`);
  if (t.to) where.push(`captured_at < ${P.add(t.to)}::timestamptz`);
  if (plan.near) {
    const lat = P.add(plan.near.lat);
    const lng = P.add(plan.near.lng);
    const rad = P.add(plan.near.radius_m);
    where.push(
      `(2 * 6371008.8 * asin(least(1, sqrt(power(sin(radians(lat - ${lat}::float8) / 2), 2) + ` +
        `cos(radians(${lat}::float8)) * cos(radians(lat)) * power(sin(radians(lng - ${lng}::float8) / 2), 2))))) <= ${rad}::float8`,
    );
  }
  if (plan.quality_tier) where.push(`quality_tier = ${P.add(plan.quality_tier)}`);
  for (const f of plan.filters) {
    const field = fieldOf(cat, f.field);
    if (!field) throw new Error("unvalidated plan: unknown field");
    const col = ident(field.name);
    const cast = field.kind === "number" ? "::float8" : field.kind === "boolean" ? "::boolean" : "::text";
    const conv = (v: string): SqlParam => (field.kind === "number" ? Number(v) : field.kind === "boolean" ? v.toLowerCase() === "true" : v);
    if (f.op === "is_null") where.push(`${col} is null`);
    else if (f.op === "not_null") where.push(`${col} is not null`);
    else if (f.op === "in") {
      const arr = field.kind === "number" ? f.values.map(Number) : f.values.map((v) => (field.kind === "boolean" ? String(v.toLowerCase() === "true") : v));
      const arrCast = field.kind === "number" ? "::float8[]" : field.kind === "boolean" ? "::boolean[]" : "::text[]";
      where.push(`${col} = any(${P.add(arr as string[] | number[])}${arrCast})`);
    } else {
      const op = OPS[f.op];
      if (!op) throw new Error("unvalidated plan: unknown op");
      where.push(`${col} ${op} ${P.add(conv(f.value!))}${cast}`);
    }
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const base = `with r as (select * from jsonb_to_recordset(${rowsParam}::jsonb) as x(${decl})), f as (select * from r ${whereSql})`;
  const countText = `${base} select count(*)::int as n from f`;

  const dir = (d: "asc" | "desc") => (d === "asc" ? "asc" : "desc");
  const limit = P.add(plan.limit);
  let names: string[];
  let text: string;

  if (plan.coverage !== "none") {
    if (!coverage) throw new Error("coverage plan without coverage context");
    const cells = P.add(coverage.cells);
    const target = P.add(coverage.target);
    const having =
      plan.coverage === "under_target" ? `having count(f.h3_cell) < ${target}::int` : plan.coverage === "met_target" ? `having count(f.h3_cell) >= ${target}::int` : "";
    const sortBy = plan.sort?.by === "h3_cell" ? "c.cell" : "observations";
    names = ["h3_cell", "observations", "target"];
    text =
      `${base} select c.cell as "h3_cell", count(f.h3_cell)::int as "observations", ${target}::int as "target", count(*) over ()::int as "__total" ` +
      `from unnest(${cells}::text[]) as c(cell) left join f on f.h3_cell = c.cell group by c.cell ${having} ` +
      `order by ${sortBy} ${dir(plan.sort?.dir ?? "asc")}, c.cell asc limit ${limit}::int`;
  } else {
    const g = groupAlias(plan);
    if (g !== null || plan.aggregates.length) {
      const sel: string[] = [];
      let groupExpr: string | null = null;
      if (plan.group_by.kind === "field") groupExpr = ident(plan.group_by.field!);
      else if (plan.group_by.kind === "h3_cell") groupExpr = `h3_cell`;
      else if (plan.group_by.kind === "hour") groupExpr = `to_char(date_trunc('hour', captured_at at time zone 'UTC'), ${ISO_MINUTE})`;
      else if (plan.group_by.kind === "day") groupExpr = `to_char(date_trunc('day', captured_at at time zone 'UTC'), ${ISO_MINUTE})`;
      if (groupExpr && g) sel.push(`${groupExpr} as ${ident(g)}`);
      for (const a of plan.aggregates) {
        const alias = ident(aggAlias(a.fn, a.field));
        if (a.fn === "count") sel.push(`count(${a.field ? ident(a.field) : "*"})::int as ${alias}`);
        else sel.push(`${AGG[a.fn]!(ident(a.field!))} as ${alias}`);
      }
      sel.push(`count(*) over ()::int as "__total"`);
      names = [...(g ? [g] : []), ...plan.aggregates.map((a) => aggAlias(a.fn, a.field))];
      const sortBy = plan.sort && names.includes(plan.sort.by) ? ident(plan.sort.by) : ident(names[0]!);
      const tie = g ? `, ${ident(g)} asc nulls last` : "";
      text = `${base} select ${sel.join(", ")} from f ${groupExpr ? `group by ${groupExpr}` : ""} order by ${sortBy} ${dir(plan.sort?.dir ?? "desc")} nulls last${tie} limit ${limit}::int`;
    } else {
      names = rowColumns(plan, cat);
      const sel = names.map((n) => (n === "captured_at" ? `to_char(captured_at at time zone 'UTC', ${ISO_MINUTE}) as "captured_at"` : ident(n)));
      sel.push(`count(*) over ()::int as "__total"`);
      const sortBy = plan.sort && names.includes(plan.sort.by) ? (plan.sort.by === "captured_at" ? "f.captured_at" : ident(plan.sort.by)) : "f.captured_at";
      text = `${base} select ${sel.join(", ")} from f order by ${sortBy} ${dir(plan.sort?.dir ?? "desc")} nulls last, "observation_id" asc limit ${limit}::int`;
    }
  }
  return { text, countText, params: P.list, columns: names.map((n) => ({ name: n, label: columnLabel(n), type: columnType(n, cat) })) };
}

const cellValue = (v: unknown): PublicRow[string] => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Runs a compiled plan. `inScope` = published observations before filters. */
export async function runPlan(db: Db, q: CompiledQuery, limit: number, inScope: number): Promise<CopilotResult> {
  const [raw, count] = await Promise.all([db.query<Record<string, unknown>>(q.text, q.params), db.query<{ n: number }>(q.countText, q.params.slice(0, countParams(q)))]);
  const total = Number(raw[0]?.__total ?? 0);
  const rows: PublicRow[] = raw.map((r) => Object.fromEntries(q.columns.map((c) => [c.name, cellValue(r[c.name])])));
  return {
    columns: q.columns,
    rows,
    total_rows: total,
    truncated: total > rows.length && rows.length >= limit,
    observations_matched: Number(count[0]?.n ?? 0),
    observations_in_scope: inScope,
  };
}

/** The count query uses only the params referenced by the shared CTE (highest $n in its text). */
function countParams(q: CompiledQuery): number {
  let max = 0;
  for (const m of q.countText.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}
