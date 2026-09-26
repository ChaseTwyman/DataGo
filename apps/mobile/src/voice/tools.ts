/**
 * Voice agent function tools (BUILD_PROMPT §M4) and their pure handlers. The handlers never touch
 * React or native modules: they talk to the capture screen through `ToolContext`, which is what the
 * unit tests fake.
 */
import type { FieldQuestion, Protocol } from "@groundtruth/shared";

export type NoteValue = string | number | boolean | null;

export interface CaptureStatus {
  phase: string;
  ready: boolean;
  missing: string[];
  hint: string | null;
  notes_remaining: string[];
}

export type TriggerResult = { ok: true; instruction: string } | { ok: false; reason: string };

export interface ToolContext {
  protocol: Protocol;
  getStatus(): CaptureStatus;
  triggerCapture(): TriggerResult;
  saveNote(questionId: string, value: NoteValue): void;
  reportUnsafe(description: string): void;
  endSession(reason: string): void;
}

export interface ToolResult {
  output: Record<string, unknown>;
  /** Ask the model to speak after this output (default). */
  respond: boolean;
  /** Close the voice session once current playback finishes. */
  endAfterPlayback: boolean;
}

export interface RealtimeFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_NAMES = ["get_capture_status", "trigger_capture", "save_field_note", "report_unsafe", "end_session"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function buildTools(protocol: Protocol): RealtimeFunctionTool[] {
  const qids = protocol.capture.field_questions.map((q) => q.id);
  return [
    {
      type: "function",
      name: "get_capture_status",
      description: "Get the latest camera checklist: what is missing, the coaching hint, and whether the shutter is ready.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      type: "function",
      name: "trigger_capture",
      description:
        "Start the capture when the user says capture (or similar) and the status is ready. Returns a movement instruction to read to the user.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      type: "function",
      name: "save_field_note",
      description: "Save the user's answer to one field question after capture.",
      parameters: {
        type: "object",
        properties: {
          question_id: qids.length ? { type: "string", enum: qids } : { type: "string" },
          value: { type: ["string", "number", "boolean"], description: "The user's answer." },
        },
        required: ["question_id", "value"],
      },
    },
    {
      type: "function",
      name: "report_unsafe",
      description: "The user feels unsafe, is unsure, or describes danger. Ends the session with no penalty.",
      parameters: {
        type: "object",
        properties: { description: { type: "string", description: "What the user said about the danger." } },
        required: ["description"],
      },
    },
    {
      type: "function",
      name: "end_session",
      description: "End the capture session, after field notes are saved (or if the user wants to stop).",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  ];
}

const YES = /^(y|yes|yeah|yep|yup|true|sure|there is|there are|some|a little|lots?|si|sí|oui)\b/i;
const NO = /^(n|no|nope|none|nothing|false|not really|there isn'?t|there aren'?t|non)\b/i;

export type CoerceResult = { ok: true; value: NoteValue } | { ok: false; error: string };

/** Coerce a spoken answer into the question's type. Pure; unit-tested. */
export function coerceFieldNote(q: FieldQuestion, raw: unknown): CoerceResult {
  if (raw === null || raw === undefined) return { ok: false, error: "empty answer" };
  switch (q.type) {
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const s = String(raw).trim();
      if (YES.test(s)) return { ok: true, value: true };
      if (NO.test(s)) return { ok: true, value: false };
      return { ok: false, error: `expected yes or no, got "${s}"` };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw).replace(/[^0-9.+-]/g, ""));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "expected a number" };
    }
    case "enum": {
      const s = String(raw).trim().toLowerCase();
      const exact = q.options.find((o) => o.toLowerCase() === s);
      if (exact) return { ok: true, value: exact };
      const contained = q.options.filter((o) => new RegExp(`\\b${escapeRe(o.toLowerCase())}\\b`).test(s));
      if (contained.length === 1) return { ok: true, value: contained[0] ?? null };
      return { ok: false, error: `expected one of: ${q.options.join(", ")}` };
    }
    case "text": {
      const s = String(raw).trim();
      return s ? { ok: true, value: s.slice(0, 500) } : { ok: false, error: "empty answer" };
    }
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ok = (output: Record<string, unknown>, extra: Partial<ToolResult> = {}): ToolResult => ({
  output,
  respond: true,
  endAfterPlayback: false,
  ...extra,
});

export function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  switch (name) {
    case "get_capture_status":
      return ok({ ...ctx.getStatus() });
    case "trigger_capture": {
      const status = ctx.getStatus();
      if (!status.ready) {
        return ok({ started: false, reason: "not_ready", missing: status.missing, hint: status.hint });
      }
      const r = ctx.triggerCapture();
      if (!r.ok) return ok({ started: false, reason: r.reason });
      return ok({ started: true, instruction: r.instruction, say: "Read the instruction to the user word for word." });
    }
    case "save_field_note": {
      const qid = typeof args.question_id === "string" ? args.question_id : "";
      const q = ctx.protocol.capture.field_questions.find((f) => f.id === qid);
      if (!q) return ok({ saved: false, error: `unknown question_id "${qid}"` });
      const c = coerceFieldNote(q, args.value);
      if (!c.ok) return ok({ saved: false, question_id: qid, error: c.error, ask_again: q.question });
      ctx.saveNote(qid, c.value);
      return ok({ saved: true, question_id: qid, value: c.value, remaining: ctx.getStatus().notes_remaining });
    }
    case "report_unsafe": {
      const d = typeof args.description === "string" ? args.description : "";
      ctx.reportUnsafe(d);
      // Let the model thank the user, then hang up.
      return ok({ ended: true, penalty: false, say: "Thank the user and remind them there is no penalty." }, { endAfterPlayback: true });
    }
    case "end_session": {
      const reason = typeof args.reason === "string" ? args.reason : "done";
      ctx.endSession(reason);
      return ok({ ended: true }, { respond: false, endAfterPlayback: true });
    }
    default:
      return ok({ error: `unknown tool "${name}"` });
  }
}
