/** Vision calls: live frame checks (fast model) and final verification (reasoning model). */
import {
  buildVerificationJsonSchema,
  frameCheckJsonSchema,
  frameCheckZod,
  parseVerification,
  type Challenge,
  type FrameCheckResult,
  type MockVariant,
  type Protocol,
  type VerificationOutput,
} from "@groundtruth/shared";
import { grokEnv } from "./config";
import { grokJSON, imagePart } from "./json";
import { mockFrameCheck, mockVerification } from "./mocks/fixtures";

export function frameCheckSystemPrompt(protocol: Protocol): string {
  const elements = protocol.capture.required_elements.map((e) => `${e.id}: ${e.description}`).join("; ");
  return [
    `You are the real-time camera assistant for a scientific data-collection protocol called "${protocol.name}".`,
    "You see one low-resolution frame from a phone camera.",
    `Required elements: ${elements}.`,
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
    mock: async () => {
      if (args.variant === "slow") await new Promise((r) => setTimeout(r, 12_000));
      return mockFrameCheck(args.protocol, args.variant);
    },
  });
}

export function verificationSystemPrompt(protocol: Protocol, challenge: Challenge, frames: number, intervalMs: number): string {
  return [
    "You are a skeptical auditor for a paid scientific data network. Contributors are paid per accepted observation, so some will try to cheat.",
    `You receive ${frames} frames captured ${intervalMs} ms apart while the contributor was instructed: "${challenge.instruction}".`,
    `Expected if genuine: "${challenge.expect}".`,
    `Protocol: ${JSON.stringify(protocol)}.`,
    "For every judgment, cite specific visual evidence.",
    "Check whether the frames show a real three-dimensional scene with natural parallax between frames, or a flat surface such as a screen or print.",
    "Look for signs of AI generation, editing, or compositing, and for internal inconsistencies (for example dry pavement beside supposed floodwater, mismatched shadows or reflections).",
    "Score conservatively: when unsure, lower the score rather than guess.",
    "For extraction, estimate values from the reference object and state the height you assumed (typical: curb ≈ 15 cm, car tire ≈ 65 cm tall, fire hydrant ≈ 75 cm; for a measuring stick, read the markings).",
  ].join(" ");
}

export async function verifyCapture(args: {
  protocol: Protocol;
  challenge: Challenge;
  framesBase64: string[];
  intervalMs: number;
  variant?: MockVariant;
  timeoutMs?: number;
}): Promise<VerificationOutput> {
  const n = args.framesBase64.length;
  return grokJSON({
    op: "verification",
    model: grokEnv.reasoningModel,
    system: verificationSystemPrompt(args.protocol, args.challenge, n, args.intervalMs),
    content: [
      { type: "input_text", text: `Frames 1..${n} follow in capture order.` },
      ...args.framesBase64.map((b) => imagePart(b, "high")),
    ],
    schema: buildVerificationJsonSchema(args.protocol),
    name: "verification",
    parse: (raw) => parseVerification(args.protocol, raw),
    timeoutMs: args.timeoutMs ?? 60_000,
    mock: () => mockVerification(args.protocol, args.variant),
  });
}
