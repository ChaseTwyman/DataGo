/**
 * Ask the data, client side: lenient response parsing, the example chips, and pure helpers for the
 * chart, the cell map and the CSV download (unit-tested in copilot.test.ts). Contract:
 * packages/shared/src/contracts/copilot.ts.
 */
import { z } from "zod";
import { lenientArray, openString, PublicCellValueSchema, type CopilotChart } from "@groundtruth/shared";
import { apiFetch } from "./api";
import { LenientGrokbotMessageSchema } from "./grokbot";

const ColumnSchema = z.object({
  name: z.string(),
  label: z.string().catch(""),
  type: openString<"number" | "string" | "datetime" | "boolean">().catch("string"),
});
export type AskColumn = z.infer<typeof ColumnSchema>;

const ResultSchema = z.object({
  columns: lenientArray(ColumnSchema),
  rows: lenientArray(z.record(z.string(), PublicCellValueSchema)),
  total_rows: z.number().catch(0),
  truncated: z.boolean().catch(false),
  observations_matched: z.number().catch(0),
  observations_in_scope: z.number().catch(0),
});
export type AskResult = z.infer<typeof ResultSchema>;

export const LenientCopilotAnswerSchema = z.object({
  status: openString<"answered" | "refused">(),
  question: z.string().catch(""),
  refusal: z.string().nullable().catch(null),
  dataset: z.object({ slug: z.string(), name: z.string(), version: z.number() }).nullable().catch(null),
  /** Shown verbatim under "How I answered"; kept as data, never interpreted client-side. */
  plan: z.record(z.string(), z.unknown()).nullable().catch(null),
  plan_steps: lenientArray(z.string()),
  result: ResultSchema.nullable().catch(null),
  answer: LenientGrokbotMessageSchema.nullable().catch(null),
  methods: z.string().nullable().catch(null),
  chart: openString<CopilotChart>().catch("table"),
  planner: z.string().catch("none"),
  generated_at: z.string().nullable().catch(null),
});
export type AskAnswer = z.infer<typeof LenientCopilotAnswerSchema>;

export interface AskBody {
  question: string;
  dataset?: string;
  bounty_id?: string;
}

/** `public` → the no-login endpoint (no bearer header sent). */
export function askData(body: AskBody, mode: "researcher" | "public"): Promise<AskAnswer> {
  return mode === "public"
    ? apiFetch("/api/public/copilot/ask", LenientCopilotAnswerSchema, { body, auth: false })
    : apiFetch("/api/copilot/ask", LenientCopilotAnswerSchema, { body });
}

export const PUBLIC_EXAMPLES = [
  "What were the deepest readings within 1 km of Midtown in the last 3 hours?",
  "Median depth by surface type?",
  "Readings per hour in the last 24 hours",
  "Which cells have the most readings?",
] as const;

export const RESEARCHER_EXAMPLES = [...PUBLIC_EXAMPLES.slice(0, 2), "How many cells are still under target?", ...PUBLIC_EXAMPLES.slice(2)] as const;

type Cell = z.infer<typeof PublicCellValueSchema>;

export function cellText(v: Cell | undefined, type = "string"): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (type === "datetime") return v.replace("T", " ").replace(/:00(\.000)?Z$/, " UTC").replace(/Z$/, " UTC");
  return v;
}

export interface Series {
  /** Category / time label per point, in result order (time: ascending). */
  labels: string[];
  values: number[];
  valueLabel: string;
  keyLabel: string;
}

/**
 * Bar/line data: the first non-numeric column is the key, the first numeric column the value.
 * Rows with a null value are skipped (a gap, not a made-up zero). null when nothing plottable.
 */
export function chartSeries(result: AskResult, chart: string): Series | null {
  if (chart !== "bar" && chart !== "line") return null;
  const key = result.columns.find((c) => c.type !== "number");
  const val = result.columns.find((c) => c.type === "number");
  if (!key || !val) return null;
  let rows = result.rows.filter((r) => typeof r[val.name] === "number");
  if (chart === "line") rows = [...rows].sort((a, b) => String(a[key.name]).localeCompare(String(b[key.name])));
  if (rows.length === 0) return null;
  return {
    labels: rows.map((r) => cellText(r[key.name], key.type)),
    values: rows.map((r) => r[val.name] as number),
    valueLabel: val.label || val.name,
    keyLabel: key.label || key.name,
  };
}

/** Cells for the hex map: count/observations (or 1 per row) per h3_cell. */
export function mapCells(result: AskResult): { h3_cell: string; rows: number }[] {
  if (!result.columns.some((c) => c.name === "h3_cell")) return [];
  const weight = result.columns.find((c) => c.name === "count" || c.name === "observations");
  const by = new Map<string, number>();
  for (const r of result.rows) {
    const cell = r.h3_cell;
    if (typeof cell !== "string" || !cell) continue;
    const w = weight ? Number(r[weight.name] ?? 0) : 1;
    by.set(cell, (by.get(cell) ?? 0) + (Number.isFinite(w) ? w : 0));
  }
  // Zero-observation cells (coverage: under target) are kept; the map draws them faintly.
  return [...by.entries()].map(([h3_cell, rows]) => ({ h3_cell, rows }));
}

/** CSV of the result (formula-looking strings neutralised, like the server export). */
export function resultCsv(result: AskResult): string {
  const cell = (v: Cell | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const names = result.columns.map((c) => c.name);
  return [names.join(","), ...result.rows.map((r) => names.map((n) => cell(r[n])).join(","))].join("\r\n") + "\r\n";
}

export function downloadText(text: string, filename: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
