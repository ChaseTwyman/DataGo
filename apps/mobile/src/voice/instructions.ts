/**
 * Voice agent instructions (BUILD_PROMPT §7.3). Second person, fixed section order:
 * Role → Safety → Protocol → How you coach → Style. Safety is always first after Role.
 */
import type { FieldQuestion, Protocol } from "@groundtruth/shared";

export const INSTRUCTION_SECTIONS = ["# Role", "# Safety (always first)", "# Protocol:", "# How you coach", "# Style"] as const;

export interface InstructionContext {
  bountyTitle?: string;
  bountySummary?: string;
  challengeInstruction?: string;
}

function describeQuestion(q: FieldQuestion): string {
  switch (q.type) {
    case "enum":
      return `${q.id}: "${q.question}" (answer one of: ${q.options.join(", ")})`;
    case "boolean":
      return `${q.id}: "${q.question}" (yes/no)`;
    case "number":
      return `${q.id}: "${q.question}" (a number)`;
    case "text":
      return `${q.id}: "${q.question}" (short text)`;
  }
}

export function buildInstructions(protocol: Protocol, ctx: InstructionContext = {}): string {
  const rules = protocol.safety.rules.map((r) => `- ${r}`).join("\n");
  const elements = protocol.capture.required_elements.map((e) => `${e.label} (${e.description})`).join("; ");
  const questions = protocol.capture.field_questions.length
    ? protocol.capture.field_questions.map((q) => `- ${describeQuestion(q)}`).join("\n")
    : "- (none)";
  const bounty = ctx.bountyTitle
    ? `\nThis bounty: ${ctx.bountyTitle}${ctx.bountySummary ? `. ${ctx.bountySummary}` : ""}`
    : "";

  return [
    "# Role",
    "You are the GroundTruth field guide. You help a volunteer capture one scientific observation safely and correctly, hands-free.",
    "",
    "# Safety (always first)",
    rules,
    "If the user says they feel unsafe, is unsure, or describes danger, call report_unsafe and thank them. Never tell them to approach water, hazards, or traffic.",
    "",
    `# Protocol: ${protocol.name}`,
    `Why it matters: ${protocol.why_it_matters}${bounty}`,
    `Required in frame: ${elements}`,
    "Field questions to ask after capture:",
    questions,
    "",
    "# How you coach",
    "- You cannot see the camera. You receive [camera_status] messages; coach only from the latest one.",
    "- One short sentence at a time, under 12 words.",
    '- When ready is true, say "Hold still" and wait. When the user says "capture" or similar, call trigger_capture.',
    "- trigger_capture returns a movement instruction. Read it to the user word for word, then stay quiet while the burst is taken.",
    "- After capture, ask each field question once and call save_field_note with the answer.",
    "- Then say the observation is being verified and call end_session.",
    "",
    "# Style",
    "Calm, warm, brief. Reply in the user's language.",
  ].join("\n");
}

/** Scripted opener spoken verbatim via `force_message` (PRD §7.4 step 2). */
export function safetyOpener(protocol: Protocol): string {
  return `You're in the zone. Quick safety check: ${protocol.safety.check_in_question}`;
}

/** Per-response instructions used after a [camera_status] injection (BUILD_PROMPT §M4). */
export const CAMERA_STATUS_RESPONSE_INSTRUCTIONS =
  "Give one short coaching sentence based on the latest camera_status. If ready is true, say \"Hold still\" and wait for the user to say capture.";

export const CAPTURE_DONE_RESPONSE_INSTRUCTIONS =
  "The burst was captured. Ask the first unanswered field question now, in one short sentence.";

export const VOICE_TEST_INSTRUCTIONS =
  "You are a friendly voice assistant being latency-tested. Reply in one short sentence. Reply in the user's language.";
