/** Vision calls: live frame checks (fast model) and final verification (reasoning model). */
import { z } from "zod";
import {
  buildVerificationJsonSchema,
  closeObjects,
  frameCheckJsonSchema,
  frameCheckZod,
  parseVerification,
  relevanceJsonSchema,
  relevanceZod,
  type Challenge,
  type FrameCheckResult,
  type JsonSchema,
  type MockVariant,
  type Protocol,
  type RelevanceResult,
  type VerificationOutput,
} from "@groundtruth/shared";
import { grokEnv } from "./config";
import { grokJSON, imagePart } from "./json";
import { mockFrameCheck, mockPrivacyRegions, mockRelevance, mockVerification } from "./mocks/fixtures";

/** "id: description" per element; optional (secondary) ones are tagged so models treat them as nice-to-have. */
function elementList(protocol: Protocol): string {
  return protocol.capture.required_elements.map((e) => `${e.id}${e.optional ? " (optional)" : ""}: ${e.description}`).join("; ");
}

/**
 * Shared by the frame-check and verification prompts. Contributors hold the phone either way and
 * the stored frame's EXIF rotation varies; the reasoning model marked genuine portrait captures
 * BAD_FRAMING against `orientation: "landscape"` (2026-09-27 cashew test).
 */
const ORIENTATION_RULE =
  "Orientation (portrait vs landscape) is never a quality criterion: never set framing_ok false and never lower a score because the photo is portrait instead of landscape or vice versa. framing_ok is only about whether the required elements are inside the frame and unobstructed.";

export function frameCheckSystemPrompt(protocol: Protocol): string {
  return [
    `You are the real-time camera assistant for a scientific data-collection protocol called "${protocol.name}".`,
    "You see one low-resolution frame from a phone camera.",
    `Required elements: ${elementList(protocol)}.`,
    "Elements marked (optional) are nice to have: report them, but only hint about them once everything else is in place.",
    ORIENTATION_RULE,
    "Judge only what is visible; do not assume.",
    "Set `suspected_screen_or_print` if you see moiré, a pixel grid, a screen bezel or display glare, or paper edges and print texture.",
    "Give one short imperative hint that would most improve the shot.",
    'If every element is visible and the shot is steady and well lit, the hint is "Hold still."',
  ].join(" ");
}

export async function frameCheck(args: {
  protocol: Protocol;
  imageBase64: string;
  variant?: MockVariant;
  timeoutMs?: number;
}): Promise<FrameCheckResult> {
  const zod = frameCheckZod(args.protocol);
  return grokJSON({
    op: "frame_check",
    model: grokEnv.fastVisionModel,
    system: frameCheckSystemPrompt(args.protocol),
    content: [imagePart(args.imageBase64, "low")],
    schema: frameCheckJsonSchema(args.protocol),
    name: "frame_check",
    parse: (raw) => zod.parse(raw),
    timeoutMs: args.timeoutMs ?? 8_000,
    // The phone's gate loop retries on its own and degrades after 10 s; an SDK retry would only
    // push a stale frame's answer past that window.
    maxRetries: 0,
    mock: async () => {
      if (args.variant === "slow") await new Promise((r) => setTimeout(r, 12_000));
      return mockFrameCheck(args.protocol, args.variant);
    },
  });
}

export function relevanceSystemPrompt(protocol: Protocol): string {
  return [
    `You screen photos submitted to a scientific data-collection protocol called "${protocol.name}".`,
    `What the protocol collects: ${protocol.why_it_matters}`,
    `Required elements: ${elementList(protocol)}.`,
    "You see one frame from the contributor's burst. Decide only whether it shows a real-world scene of this protocol's subject at all; quality, completeness and authenticity are judged later by someone else.",
    "subject_match: does the frame show the protocol's subject? If the main subject is visible, subject_match is true even when other required elements are missing, the framing is imperfect, the orientation is portrait or landscape, or other objects clutter the scene.",
    "elements: for each required element, is it visible in this frame?",
    // Tried and rejected (2026-09-27): listing "an indoor object" and "a product" as off-topic
    // examples. They made the model call a cashew jar off-topic for a packaged-goods protocol.
    "off_topic: set value true only when the protocol's subject is genuinely absent and the frame shows something unrelated to it (for example a person's face, a pet, a blank wall, a screen showing unrelated content, or an object of a different kind than the protocol asks for). Missing secondary elements, framing, orientation or background clutter never make a frame off-topic. what_it_is: a short plain description of what the frame actually shows (max 20 words). Judge only what is visible; do not assume.",
  ].join(" ");
}

/**
 * Fast relevance screen (one downscaled frame, fast vision model, strict schema, ~2 s). Runs before
 * the slow reasoning model and independently of it, so an off-topic capture is rejected even when
 * the reasoning model times out. No SDK retry: an error surfaces as a stage error (→ review).
 */
export async function relevanceCheck(args: {
  protocol: Protocol;
  imageBase64: string;
  variant?: MockVariant;
  timeoutMs?: number;
}): Promise<RelevanceResult> {
  const zod = relevanceZod(args.protocol);
  return grokJSON({
    op: "relevance",
    model: grokEnv.fastVisionModel,
    system: relevanceSystemPrompt(args.protocol),
    content: [imagePart(args.imageBase64, "low")],
    schema: relevanceJsonSchema(args.protocol),
    name: "relevance",
    parse: (raw) => zod.parse(raw),
    timeoutMs: args.timeoutMs ?? 20_000,
    maxRetries: 0,
    mock: () => mockRelevance(args.protocol, args.variant),
  });
}

export function verificationSystemPrompt(protocol: Protocol, challenge: Challenge, frames: number, intervalMs: number): string {
  return [
    "You are a skeptical auditor for a paid scientific data network. Contributors are paid per accepted observation, so some will try to cheat.",
    `You receive ${frames} frames captured ${intervalMs} ms apart while the contributor was instructed: "${challenge.instruction}".`,
    `Expected if genuine: "${challenge.expect}".`,
    `Protocol: ${JSON.stringify(protocol)}.`,
    // Leniency rules (2026-09-27): authentic indoor captures were rejected on a strict reading of a
    // ~1.4 s challenge, a missing secondary element, and orientation. Fakes are caught by the
    // authenticity checks, not by these.
    "The challenge is a light liveness hint, not the main test, and the burst is short: any small change in viewpoint, scale, framing or perspective between frames counts as performed, even if it is slight or not exactly in the requested direction. Set challenge.performed false only when the frames show no camera movement at all or are identical copies of one image.",
    "protocol_score measures only the required elements, image quality and the extraction; do not lower it for the challenge, for orientation, or for background clutter.",
    "Elements marked optional: true are secondary: report them honestly, but a missing optional element lowers protocol_score by at most 0.1.",
    ORIENTATION_RULE,
    ...(protocol.capture.setting === "indoor" ? ["This is an indoor protocol: artificial lighting at any hour is expected and is not an inconsistency."] : []),
    "For every judgment, cite specific visual evidence.",
    "Check whether the frames show a real three-dimensional scene with natural parallax between frames, or a flat surface such as a screen or print.",
    "Look for signs of AI generation, editing, or compositing, and for internal inconsistencies (for example dry pavement beside supposed floodwater, mismatched shadows or reflections).",
    "Score conservatively: when unsure, lower the score rather than guess.",
    "For extraction, estimate values from the reference object and state the height you assumed (typical: curb ≈ 15 cm, car tire ≈ 65 cm tall, fire hydrant ≈ 75 cm; for a measuring stick, read the markings).",
    // Tried and rejected (2026-09-26 eval): a "be terse" instruction + maxLength caps on evidence
    // strings. Output tokens fell, but a pseudo-parallax Imagine fake that medium effort had rejected
    // was then accepted; reasoning length is what catches it. Don't trim the audit for latency.
  ].join(" ");
}

/** Image detail per burst frame: "mixed" keeps the first and last frame (the parallax pair) at high. */
export function verificationFrameDetails(n: number, mode: "high" | "mixed" | "low"): ("high" | "low")[] {
  return Array.from({ length: n }, (_, i) => (mode === "high" ? "high" : mode === "low" ? "low" : i === 0 || i === n - 1 ? "high" : "low"));
}

export async function verifyCapture(args: {
  protocol: Protocol;
  challenge: Challenge;
  framesBase64: string[];
  intervalMs: number;
  variant?: MockVariant;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<VerificationOutput> {
  const n = args.framesBase64.length;
  const details = verificationFrameDetails(n, grokEnv.verificationImageDetail);
  return grokJSON({
    op: "verification",
    model: grokEnv.reasoningModel,
    system: verificationSystemPrompt(args.protocol, args.challenge, n, args.intervalMs),
    content: [
      { type: "input_text", text: `Frames 1..${n} follow in capture order.` },
      ...args.framesBase64.map((b, i) => imagePart(b, details[i]!)),
    ],
    schema: buildVerificationJsonSchema(args.protocol),
    name: "verification",
    parse: (raw) => parseVerification(args.protocol, raw),
    // One attempt with a generous budget: from Vercel this call exceeded 60 s, and the SDK's hidden
    // retry then doubled it. Must stay under the route/after() limit (300 s on Vercel Hobby).
    timeoutMs: args.timeoutMs ?? grokEnv.verificationTimeoutMs,
    maxRetries: 0,
    reasoningEffort: grokEnv.verificationEffort,
    ...(args.signal ? { signal: args.signal } : {}),
    mock: () => mockVerification(args.protocol, args.variant),
  });
}

// ---------- Privacy regions (faces, licence plates) for post-decision redaction ----------

const unit = z.number().min(0).max(1);
export const PrivacyDetectionSchema = z.object({
  faces_or_plates_present: z.boolean(),
  regions: z
    .array(z.object({ kind: z.enum(["face", "license_plate"]), x: unit, y: unit, w: unit, h: unit, confidence: unit }))
    .max(64),
});
export type PrivacyDetection = z.infer<typeof PrivacyDetectionSchema>;

export const PRIVACY_SYSTEM_PROMPT = [
  "You find privacy-sensitive regions in a photo so they can be blurred before researchers see it.",
  "Report every human face (including partial, distant, turned-away heads with visible facial features, faces in reflections, windows and posters) and every vehicle licence plate (readable or not).",
  "For each, give a bounding box in coordinates normalised to the image: x and y are the top-left corner as a fraction of the image width and height (0 = left/top edge, 1 = right/bottom edge), w and h are the box width and height as fractions of the image width and height.",
  "Boxes must cover the whole face or plate; when unsure of an edge, make the box larger. When unsure whether something is a face or a plate, include it.",
  "faces_or_plates_present is true if any face or plate is visible at all, even if you cannot box it precisely.",
].join(" ");

/**
 * One fast-vision call per frame. Runs after the decision (never on the verification path), so it
 * has a longer budget and one SDK retry. Box accuracy is not documented by xAI: callers grow every
 * box by a safety margin (lib/image/redact.ts) and blur the whole frame if the model says a face or
 * plate is present but returns no boxes.
 */
export async function detectPrivacyRegions(args: { imageBase64: string; timeoutMs?: number }): Promise<PrivacyDetection> {
  return grokJSON({
    op: "privacy_regions",
    model: grokEnv.fastVisionModel,
    system: PRIVACY_SYSTEM_PROMPT,
    content: [imagePart(args.imageBase64, "high")],
    schema: closeObjects(z.toJSONSchema(PrivacyDetectionSchema) as JsonSchema),
    name: "privacy_regions",
    parse: (raw) => PrivacyDetectionSchema.parse(raw),
    timeoutMs: args.timeoutMs ?? 45_000,
    maxRetries: 1,
    mock: () => mockPrivacyRegions(),
  });
}
