/**
 * Read-side (lenient) parsing of the Grokbot contract (packages/shared/src/contracts/grokbot.ts).
 * Same rules as contracts/lenient.ts: open strings for enums, lists drop bad items, and a newer
 * server's extra fields are ignored — an installed build must not break when the server evolves.
 */
import { lenientArray, openString, type GrokbotCitation } from "@groundtruth/shared";
import { z } from "zod";

export const LenientCitationSchema = z.object({
  kind: openString<GrokbotCitation["kind"]>(),
  ref: z.string(),
  detail: z.string().nullable().optional().catch(null),
});
export type LenientCitation = z.infer<typeof LenientCitationSchema>;

export const LenientGrokbotMessageSchema = z.object({
  headline: z.string(),
  paragraphs: lenientArray(z.string()),
  next_steps: lenientArray(z.string()),
  citations: lenientArray(LenientCitationSchema),
  source: openString<"grok" | "template">().catch("template"),
  generated_at: z.string().nullable().optional().catch(null),
});
export type LenientGrokbotMessage = z.infer<typeof LenientGrokbotMessageSchema>;

export const LenientNarrationLineSchema = z.object({
  seq: z.number().int(),
  stage: z.string().catch(""),
  text: z.string(),
  at: z.string().nullable().optional().catch(null),
});
export type LenientNarrationLine = z.infer<typeof LenientNarrationLineSchema>;

export const LenientNarrationResponseSchema = z.object({
  lines: lenientArray(LenientNarrationLineSchema),
  done: z.boolean().catch(false),
  final: LenientGrokbotMessageSchema.nullable().catch(null),
});
export type LenientNarrationResponse = z.infer<typeof LenientNarrationResponseSchema>;

export const LenientMatchRefreshSchema = z.object({ refreshed: z.number().catch(0) }).catch({ refreshed: 0 });
