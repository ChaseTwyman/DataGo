import { describe, expect, it } from "vitest";
import { parseServerEvent, parseToolArgs } from "../src/voice/events";

const p = (o: unknown) => parseServerEvent(JSON.stringify(o));

describe("parseServerEvent", () => {
  it("maps both audio delta spellings", () => {
    for (const type of ["response.output_audio.delta", "response.audio.delta"]) {
      expect(p({ type, response_id: "r1", delta: "AAAA" })).toEqual({ kind: "audio_delta", responseId: "r1", delta: "AAAA" });
    }
  });

  it("maps both transcript delta spellings", () => {
    for (const type of ["response.output_audio_transcript.delta", "response.audio_transcript.delta"]) {
      expect(p({ type, response_id: "r1", item_id: "i1", delta: "Hi" })).toMatchObject({
        kind: "assistant_transcript_delta",
        delta: "Hi",
      });
    }
    for (const type of ["response.output_audio_transcript.done", "response.audio_transcript.done"]) {
      expect(p({ type, transcript: "Hi there" })).toMatchObject({ kind: "assistant_transcript_done", transcript: "Hi there" });
    }
  });

  it("handles input transcription: OpenAI delta, xAI cumulative update, completed", () => {
    expect(p({ type: "conversation.item.input_audio_transcription.delta", item_id: "u1", delta: "he" })).toMatchObject({
      kind: "user_transcript_delta",
    });
    expect(p({ type: "conversation.item.input_audio_transcription.updated", item_id: "u1", transcript: "hello" })).toMatchObject({
      kind: "user_transcript_partial",
      transcript: "hello",
    });
    expect(p({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "hello" })).toMatchObject({
      kind: "user_transcript_done",
    });
  });

  it("parses function calls, VAD, response lifecycle and errors", () => {
    expect(p({ type: "response.function_call_arguments.done", name: "trigger_capture", call_id: "c1", arguments: "{}" })).toMatchObject({
      kind: "function_call",
      name: "trigger_capture",
      callId: "c1",
    });
    expect(p({ type: "input_audio_buffer.speech_started" }).kind).toBe("speech_started");
    expect(p({ type: "input_audio_buffer.speech_stopped" }).kind).toBe("speech_stopped");
    expect(p({ type: "response.created", response: { id: "r9" } })).toEqual({ kind: "response_created", responseId: "r9" });
    expect(p({ type: "response.done", response: { id: "r9", status: "completed" } })).toEqual({
      kind: "response_done",
      responseId: "r9",
      status: "completed",
    });
    expect(p({ type: "error", error: { message: "bad", code: "x" } })).toEqual({ kind: "error", message: "bad", code: "x" });
  });

  it("flags unknown and invalid input instead of throwing", () => {
    expect(p({ type: "something.new" })).toMatchObject({ kind: "unknown", type: "something.new" });
    expect(p({ type: "response.output_item.added" })).toEqual({ kind: "ignored", type: "response.output_item.added" });
    expect(parseServerEvent("{nope").kind).toBe("invalid");
    expect(parseServerEvent(JSON.stringify({ no: "type" })).kind).toBe("invalid");
  });

  it("parseToolArgs tolerates empty and malformed arguments", () => {
    expect(parseToolArgs("")).toEqual({});
    expect(parseToolArgs("not json")).toEqual({});
    expect(parseToolArgs("[1]")).toEqual({});
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
  });
});
