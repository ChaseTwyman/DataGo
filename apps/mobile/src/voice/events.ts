/**
 * Server → client realtime events, normalized. xAI speaks the OpenAI Realtime protocol but uses the
 * beta names for some output events (BUILD_PROMPT §5), so both spellings map to one kind here.
 * Unknown types are surfaced as `unknown` so the caller can log them during the spike.
 */

export type ServerEvent =
  | { kind: "session_created"; raw: Record<string, unknown> }
  | { kind: "session_updated"; raw: Record<string, unknown> }
  | { kind: "response_created"; responseId: string | null }
  | { kind: "response_done"; responseId: string | null; status: string | null }
  | { kind: "audio_delta"; responseId: string | null; delta: string }
  | { kind: "audio_done"; responseId: string | null }
  | { kind: "assistant_transcript_delta"; responseId: string | null; itemId: string | null; delta: string }
  | { kind: "assistant_transcript_done"; responseId: string | null; itemId: string | null; transcript: string }
  | { kind: "user_transcript_delta"; itemId: string | null; delta: string }
  /** xAI: cumulative transcript so far (may revise earlier text), not a delta. */
  | { kind: "user_transcript_partial"; itemId: string | null; transcript: string }
  | { kind: "user_transcript_done"; itemId: string | null; transcript: string }
  | { kind: "speech_started" }
  | { kind: "speech_stopped" }
  | { kind: "function_call"; name: string; callId: string; arguments: string; responseId: string | null }
  | { kind: "error"; message: string; code: string | null }
  | { kind: "ignored"; type: string }
  | { kind: "unknown"; type: string; raw: unknown }
  | { kind: "invalid"; error: string };

/** Types we deliberately do nothing with (not worth logging as unknown). */
const IGNORED = new Set([
  "conversation.created",
  "conversation.item.created",
  "conversation.item.added",
  "conversation.item.done",
  "conversation.item.truncated",
  "input_audio_buffer.committed",
  "input_audio_buffer.cleared",
  "response.output_item.added",
  "response.output_item.done",
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.delta",
  "response.output_text.done",
  "response.text.delta",
  "response.text.done",
  "response.function_call_arguments.delta",
  "rate_limits.updated",
  "ping",
]);

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseServerEvent(data: unknown): ServerEvent {
  let msg: unknown = data;
  if (typeof data === "string") {
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return { kind: "invalid", error: e instanceof Error ? e.message : "bad json" };
    }
  }
  if (!msg || typeof msg !== "object") return { kind: "invalid", error: "not an object" };
  const m = msg as Record<string, unknown>;
  const type = str(m.type);
  if (!type) return { kind: "invalid", error: "missing type" };
  const responseId = str(m.response_id) ?? str((m.response as Record<string, unknown> | undefined)?.id);
  const itemId = str(m.item_id);

  switch (type) {
    case "session.created":
      return { kind: "session_created", raw: m };
    case "session.updated":
      return { kind: "session_updated", raw: m };
    case "response.created":
      return { kind: "response_created", responseId };
    case "response.done": {
      const status = str((m.response as Record<string, unknown> | undefined)?.status);
      return { kind: "response_done", responseId, status };
    }
    case "response.output_audio.delta":
    case "response.audio.delta":
      return { kind: "audio_delta", responseId, delta: str(m.delta) ?? "" };
    case "response.output_audio.done":
    case "response.audio.done":
      return { kind: "audio_done", responseId };
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta":
      return { kind: "assistant_transcript_delta", responseId, itemId, delta: str(m.delta) ?? "" };
    case "response.output_audio_transcript.done":
    case "response.audio_transcript.done":
      return { kind: "assistant_transcript_done", responseId, itemId, transcript: str(m.transcript) ?? "" };
    case "conversation.item.input_audio_transcription.delta":
      return { kind: "user_transcript_delta", itemId, delta: str(m.delta) ?? "" };
    case "conversation.item.input_audio_transcription.updated":
      return { kind: "user_transcript_partial", itemId, transcript: str(m.transcript) ?? "" };
    case "conversation.item.input_audio_transcription.completed":
    case "conversation.item.input_audio_transcription.done":
      return { kind: "user_transcript_done", itemId, transcript: str(m.transcript) ?? "" };
    case "input_audio_buffer.speech_started":
      return { kind: "speech_started" };
    case "input_audio_buffer.speech_stopped":
      return { kind: "speech_stopped" };
    case "response.function_call_arguments.done":
      return {
        kind: "function_call",
        name: str(m.name) ?? "",
        callId: str(m.call_id) ?? "",
        arguments: str(m.arguments) ?? "{}",
        responseId,
      };
    case "error": {
      const err = (m.error ?? {}) as Record<string, unknown>;
      return { kind: "error", message: str(err.message) ?? str(m.message) ?? "unknown error", code: str(err.code) };
    }
    default:
      if (IGNORED.has(type)) return { kind: "ignored", type };
      return { kind: "unknown", type, raw: m };
  }
}

/** Parse tool-call arguments; the model occasionally sends "" for no-arg tools. */
export function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
