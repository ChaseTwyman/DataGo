/**
 * Protocol Studio (P1): a plain-language data need → grok-4.7 drafts a protocol matching the shared
 * ProtocolSchema. xAI strict structured outputs default additionalProperties to false, so an arbitrary
 * extraction JSON Schema can't be expressed strictly; the model returns it as a JSON string
 * (`extraction_schema_json`) which we parse and validate with ProtocolSchema.
 */
import { closeObjects, ProtocolSchema, type JsonSchema, type Protocol } from "@groundtruth/shared";
import { z } from "zod";
import { grokEnv } from "./grok/config";
import { grokJSON } from "./grok/json";
import { mockProtocolDraft } from "./grok/mocks/p1";
import { streetFloodDepth } from "@groundtruth/shared";

export const DraftModelSchema = ProtocolSchema.omit({ extraction_schema: true }).extend({
  extraction_schema_json: z.string().min(2),
});

export function draftJsonSchema(): JsonSchema {
  const js = z.toJSONSchema(DraftModelSchema) as JsonSchema;
  delete js.$schema;
  return closeObjects(js);
}

export function parseDraft(raw: unknown): Protocol {
  const m = DraftModelSchema.parse(raw);
  const { extraction_schema_json, ...rest } = m;
  const extraction = JSON.parse(extraction_schema_json) as unknown;
  return ProtocolSchema.parse({ ...rest, extraction_schema: extraction });
}

const SYSTEM = [
  "You design scientific field-data protocols for GroundTruth, a paid citizen-science network where contributors capture photos with a phone under voice coaching and every capture is verified by a skeptical vision model.",
  "Given a researcher's plain-language data need, draft ONE protocol. Requirements:",
  "- required_elements: 2-4 things that must be visible, each with a short id (snake_case), label, and a description a vision model can check.",
  "- challenges: 2-3 physical movements performed during a 3-frame burst that produce visible change (parallax, scale, or surface change), each with the expected visual evidence.",
  "- safety: level, a yes/no check-in question, and concrete rules; never reward approaching hazards.",
  "- field_questions: 1-3 quick spoken questions (enum, boolean, number, or text).",
  "- extraction_schema_json: a JSON Schema object (as a JSON string) with type object, properties, and required, for the structured values the verifier should estimate from the photos; use nullable types for values that may be unreadable and include a 0..1 confidence field.",
  "- acceptance: min scores ~0.7 protocol / 0.8 authenticity; precipitation_plausibility null unless the data is weather-driven; corroboration radius/window suited to how fast the phenomenon changes.",
  "- example_image_prompt: a photorealistic instructional 'ideal shot' description.",
  "- slug: lowercase-hyphenated; version 1.",
  `Here is a complete example protocol for reference: ${JSON.stringify(streetFloodDepth)}`,
].join("\n");

export async function draftProtocol(need: string): Promise<Protocol> {
  return grokJSON({
    op: "protocol_draft",
    model: grokEnv.reasoningModel,
    system: SYSTEM,
    content: [{ type: "input_text", text: `Data need: ${need}` }],
    schema: draftJsonSchema(),
    name: "protocol_draft",
    parse: parseDraft,
    timeoutMs: 120_000,
    mock: () => mockProtocolDraft(need),
  });
}
