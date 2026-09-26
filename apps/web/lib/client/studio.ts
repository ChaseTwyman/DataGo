/**
 * Protocol Studio client helpers. Pure (no React) except the draft-job store, so the editing logic is
 * unit-tested in studio.test.ts.
 *
 * Drafting takes 1-2 minutes (grok-4.7). The request lives in a module-level job so a researcher can
 * leave the Studio page and come back to the progress/result; the server saves the draft either way.
 */
import { ProtocolSchema, type Protocol } from "@groundtruth/shared";
import type { z } from "zod";

// ---------------------------------------------------------------- draft job

export type DraftJob =
  | { status: "idle" }
  | { status: "running"; need: string; startedAt: number }
  | { status: "done"; need: string; protocolId: string; protocol: Protocol; finishedAt: number }
  | { status: "error"; need: string; message: string };

let job: DraftJob = { status: "idle" };
const listeners = new Set<() => void>();

export function getDraftJob(): DraftJob {
  return job;
}

function setJob(j: DraftJob): void {
  job = j;
  for (const l of listeners) l();
}

export function subscribeDraftJob(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Starts a draft unless one is running. `run` performs the request; `describe` turns errors into copy. */
export function startDraftJob(
  need: string,
  run: (need: string) => Promise<{ protocol_id: string; protocol: Protocol }>,
  describe: (e: unknown) => string,
): boolean {
  if (job.status === "running") return false;
  setJob({ status: "running", need, startedAt: Date.now() });
  run(need).then(
    (r) => setJob({ status: "done", need, protocolId: r.protocol_id, protocol: r.protocol, finishedAt: Date.now() }),
    (e: unknown) => setJob({ status: "error", need, message: describe(e) }),
  );
  return true;
}

export function clearDraftJob(): void {
  if (job.status !== "running") setJob({ status: "idle" });
}

/** Progress copy for the elapsed time of a draft (the model doesn't stream progress). */
export function draftStage(elapsedMs: number): string {
  const s = elapsedMs / 1000;
  if (s < 15) return "Reading your data need…";
  if (s < 45) return "Designing what must be in frame and the anti-fake challenges…";
  if (s < 80) return "Writing safety rules, field questions and extraction fields…";
  if (s < 140) return "Checking the draft against the protocol schema…";
  return "Still working. Large protocols can take a little longer.";
}

// ---------------------------------------------------------------- extraction fields

export type FieldType = "number" | "number|null" | "string" | "string|null" | "boolean" | "integer";
export const FIELD_TYPES: FieldType[] = ["number", "number|null", "integer", "string", "string|null", "boolean"];

export interface ExtractionField {
  name: string;
  type: FieldType | "other";
  description: string;
  required: boolean;
}

function typeOf(prop: Record<string, unknown>): FieldType | "other" {
  const t = prop.type;
  if (typeof t === "string") return (FIELD_TYPES as string[]).includes(t) ? (t as FieldType) : "other";
  if (Array.isArray(t) && t.length === 2 && t.includes("null")) {
    const base: unknown = t.find((x) => x !== "null");
    if (base === "number") return "number|null";
    if (base === "string") return "string|null";
  }
  return "other";
}

export function extractionFields(p: Protocol): ExtractionField[] {
  const req = new Set(p.extraction_schema.required ?? []);
  return Object.entries(p.extraction_schema.properties).map(([name, prop]) => ({
    name,
    type: typeOf(prop),
    description: typeof prop.description === "string" ? prop.description : "",
    required: req.has(name),
  }));
}

function typeValue(t: FieldType): unknown {
  return t.endsWith("|null") ? [t.slice(0, -5), "null"] : t;
}

/**
 * Writes edited fields back into the JSON Schema. Keys the form doesn't show (enum, minimum, …) are
 * kept for fields that keep their name; "other" types are left untouched.
 */
export function withExtractionFields(p: Protocol, fields: ExtractionField[]): Protocol {
  const old = p.extraction_schema.properties;
  const properties: Record<string, Record<string, unknown>> = {};
  const origName = Object.keys(old);
  fields.forEach((f, i) => {
    const name = f.name.trim();
    if (!name) return;
    const base = { ...(old[name] ?? old[origName[i] ?? ""] ?? {}) };
    if (f.type !== "other") base.type = typeValue(f.type);
    if (f.description.trim()) base.description = f.description.trim();
    else delete base.description;
    properties[name] = base;
  });
  const required = fields.filter((f) => f.required && f.name.trim()).map((f) => f.name.trim());
  return { ...p, extraction_schema: { ...p.extraction_schema, type: "object", properties, required } };
}

// ---------------------------------------------------------------- validation copy

type Issue = z.core.$ZodIssue;

const SECTION: Record<string, string> = {
  name: "Name",
  why_it_matters: "Why it matters",
  safety: "Safety",
  capture: "Capture",
  extraction_schema: "Extraction fields",
  acceptance: "Acceptance thresholds",
  example_image_prompt: "Example image prompt",
  slug: "Slug",
  version: "Version",
  pricing: "Pricing",
};

function where(path: readonly PropertyKey[]): string {
  const parts: string[] = [];
  for (const seg of path) {
    if (typeof seg === "number") parts.push(`#${seg + 1}`);
    else parts.push(SECTION[String(seg)] ?? String(seg).replace(/_/g, " "));
  }
  return parts.join(" › ") || "Protocol";
}

function what(i: Issue): string {
  switch (i.code) {
    case "too_small":
      return i.origin === "array" ? "needs at least one entry" : i.origin === "string" ? "is required" : `must be at least ${String(i.minimum)}`;
    case "too_big":
      return `must be at most ${String(i.maximum)}`;
    case "invalid_format":
      return i.format === "regex" ? "must be lowercase letters, digits and underscores (start with a letter)" : "has the wrong format";
    case "invalid_type":
      return "is missing or has the wrong type";
    case "invalid_value":
      return "must be one of the allowed values";
    case "invalid_union":
      return "is not a valid entry";
    default:
      return "isn't valid";
  }
}

/** Human lines for a failed ProtocolSchema parse, at most `max`. */
export function protocolIssues(err: z.ZodError, max = 6): string[] {
  const lines = err.issues.slice(0, max).map((i) => `${where(i.path)} ${what(i)}.`);
  if (err.issues.length > max) lines.push(`…and ${err.issues.length - max} more.`);
  return lines;
}

export type ParsedJson = { ok: true; protocol: Protocol } | { ok: false; lines: string[] };

/** Raw-JSON editor → Protocol, or human error lines (never a zod dump). */
export function parseProtocolJson(text: string): ParsedJson {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, lines: ["That isn't valid JSON. Check for a missing comma, quote or bracket."] };
  }
  const r = ProtocolSchema.safeParse(raw);
  return r.success ? { ok: true, protocol: r.data } : { ok: false, lines: protocolIssues(r.error) };
}
