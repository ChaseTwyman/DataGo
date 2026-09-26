/**
 * Structured-output schemas for Grok vision calls (BUILD_PROMPT §7.1, §7.2).
 * Each schema exists twice: a zod validator for runtime checking and a JSON Schema for the
 * `text.format.json_schema` request field. The verification schema is composed at runtime:
 * base + `extraction` = the protocol's `extraction_schema`.
 */
import { z } from "zod";
import type { JsonSchema, Protocol } from "./protocols/protocol";

const conf = z.number().min(0).max(1);

// ---------- Frame check (fast vision) ----------

export function frameCheckZod(protocol: Protocol) {
  const ids = protocol.capture.required_elements.map((e) => e.id) as [string, ...string[]];
  return z.object({
    elements: z.array(z.object({ id: z.enum(ids), visible: z.boolean(), confidence: conf })),
    framing_ok: z.boolean(),
    blur_ok: z.boolean(),
    lighting_ok: z.boolean(),
    suspected_screen_or_print: z.object({ value: z.boolean(), confidence: conf }),
    hint: z.string().max(80),
  });
}

/** Protocol-independent shape of a frame check (element ids as plain strings). */
export const FrameCheckResultSchema = z.object({
  elements: z.array(z.object({ id: z.string(), visible: z.boolean(), confidence: conf })),
  framing_ok: z.boolean(),
  blur_ok: z.boolean(),
  lighting_ok: z.boolean(),
  suspected_screen_or_print: z.object({ value: z.boolean(), confidence: conf }),
  hint: z.string(),
});
export type FrameCheckResult = z.infer<typeof FrameCheckResultSchema>;

export function frameCheckJsonSchema(protocol: Protocol): JsonSchema {
  return toStrictJsonSchema(frameCheckZod(protocol));
}

// ---------- Verification (reasoning vision) ----------

const evidenced = z.object({ suspected: z.boolean(), confidence: conf, evidence: z.string() });

export const VerificationBaseSchema = z.object({
  challenge: z.object({ performed: z.boolean(), confidence: conf, evidence: z.string() }),
  real_3d_scene: z.object({ value: z.boolean(), confidence: conf, evidence: z.string() }),
  elements: z.array(
    z.object({ id: z.string(), present: z.boolean(), confidence: conf, evidence: z.string() }),
  ),
  quality: z.object({ blur_ok: z.boolean(), lighting_ok: z.boolean(), framing_ok: z.boolean() }),
  authenticity: z.object({
    screen_recapture: evidenced,
    printed_photo: evidenced,
    ai_generated: evidenced,
    edited_or_composited: evidenced,
  }),
  scene: z.object({
    lighting: z.enum(["day", "dusk_dawn", "night", "unclear"]),
    visible_weather: z.string(),
    internal_inconsistencies: z.array(z.string()),
  }),
  extraction: z.record(z.string(), z.unknown()),
  protocol_score: conf,
  authenticity_score: conf,
  summary: z.string(),
});
export type VerificationOutput = z.infer<typeof VerificationBaseSchema>;

export function buildVerificationJsonSchema(protocol: Protocol): JsonSchema {
  const base = toStrictJsonSchema(VerificationBaseSchema);
  const props = base.properties as Record<string, JsonSchema>;
  props.extraction = closeObjects(JSON.parse(JSON.stringify(protocol.extraction_schema)) as JsonSchema);
  return base;
}

/** zod-validate the model output, then check the extraction's required keys against the protocol. */
export function parseVerification(protocol: Protocol, raw: unknown): VerificationOutput {
  const out = VerificationBaseSchema.parse(raw);
  const required = protocol.extraction_schema.required ?? [];
  const missing = required.filter((k) => !(k in out.extraction));
  if (missing.length > 0) {
    throw new Error(`extraction missing required fields: ${missing.join(", ")}`);
  }
  return out;
}

// ---------- helpers ----------

function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const js = z.toJSONSchema(schema) as JsonSchema;
  delete js.$schema;
  return closeObjects(js);
}

/** Recursively set `additionalProperties: false` on every object (explicit, even though xAI defaults to it). */
export function closeObjects(node: JsonSchema): JsonSchema {
  if (node.type === "object" || (Array.isArray(node.type) && node.type.includes("object"))) {
    node.additionalProperties = false;
  }
  for (const key of ["properties", "$defs", "definitions"]) {
    const map = node[key];
    if (map && typeof map === "object") {
      for (const child of Object.values(map as Record<string, JsonSchema>)) closeObjects(child);
    }
  }
  const items = node.items;
  if (items && typeof items === "object" && !Array.isArray(items)) closeObjects(items as JsonSchema);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const arr = node[key];
    if (Array.isArray(arr)) for (const child of arr as JsonSchema[]) closeObjects(child);
  }
  return node;
}

/** A frame check is all-green when every required element is visible and quality flags pass. */
export function isFrameAllGreen(protocol: Protocol, fc: FrameCheckResult, minConfidence = 0.5): boolean {
  const visible = new Set(
    fc.elements.filter((e) => e.visible && e.confidence >= minConfidence).map((e) => e.id),
  );
  const allElements = protocol.capture.required_elements.every((e) => visible.has(e.id));
  return allElements && fc.framing_ok && fc.blur_ok && fc.lighting_ok && !fc.suspected_screen_or_print.value;
}
