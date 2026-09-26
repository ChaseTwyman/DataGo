import { describe, expect, it } from "vitest";
import {
  RealtimeVoiceSession,
  WS_OPEN,
  type AudioSink,
  type RealtimeSessionOptions,
  type SocketLike,
  type Timers,
} from "../src/voice/realtimeClient";
import type { ToolResult } from "../src/voice/tools";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  closedWith: string | null = null;
  constructor(
    public url: string,
    public token: string,
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(_code?: number, reason?: string) {
    this.closedWith = reason ?? "";
    this.readyState = 3;
  }
  open() {
    this.readyState = WS_OPEN;
    this.onopen?.();
  }
  server(ev: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
  types() {
    return this.sent.map((s) => s.type as string);
  }
}

class FakeSink implements AudioSink {
  queued = 0;
  clears = 0;
  private waiters: (() => void)[] = [];
  enqueue() {
    this.queued++;
  }
  clear() {
    this.clears++;
    this.queued = 0;
    this.drain();
  }
  isPlaying() {
    return this.queued > 0;
  }
  whenIdle() {
    return this.queued === 0 ? Promise.resolve() : new Promise<void>((r) => this.waiters.push(r));
  }
  /** Simulate playback finishing. */
  finish() {
    this.queued = 0;
    this.drain();
  }
  private drain() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
}

class FakeTimers implements Timers {
  t = 0;
  private items: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.items.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.items = this.items.filter((i) => i.id !== h);
  }
  advance(ms: number) {
    this.t += ms;
    const due = this.items.filter((i) => i.at <= this.t);
    this.items = this.items.filter((i) => i.at > this.t);
    due.forEach((i) => i.fn());
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const AUDIO = Buffer.from(new Int16Array([100, -100, 200]).buffer).toString("base64");

function setup(over: Partial<RealtimeSessionOptions> = {}) {
  let sock!: FakeSocket;
  const sink = new FakeSink();
  const timers = new FakeTimers();
  const toolCalls: string[] = [];
  const latencies: number[] = [];
  const ends: string[] = [];
  const s = new RealtimeVoiceSession({
    url: "wss://api.x.ai/v1/realtime?model=grok-voice-latest",
    token: "tok",
    socketFactory: (url, token) => (sock = new FakeSocket(url, token)),
    sink,
    timers,
    now: () => timers.t,
    session: { instructions: "be brief", tools: [], transcribeInput: true },
    toolHandler: (name): ToolResult => {
      toolCalls.push(name);
      return { output: { ok: true }, respond: true, endAfterPlayback: false };
    },
    onLatency: (ms) => latencies.push(ms),
    onEnd: (r) => ends.push(r),
    ...over,
  });
  s.connect();
  return { s, sock, sink, timers, toolCalls, latencies, ends };
}

describe("RealtimeVoiceSession: connect + session config", () => {
  it("sends session.update first, then mic audio buffered before open", () => {
    const { s, sock } = setup();
    expect(sock.token).toBe("tok");
    s.appendAudio(new Float32Array([0.1, 0.2]));
    s.appendAudio(new Float32Array([0.3]));
    expect(sock.sent).toEqual([]);
    sock.open();
    expect(sock.types()).toEqual(["session.update", "input_audio_buffer.append", "input_audio_buffer.append"]);
    const session = sock.sent[0]?.session as Record<string, unknown>;
    expect(session).toMatchObject({
      voice: "eve",
      instructions: "be brief",
      turn_detection: { type: "server_vad" },
      reasoning: { effort: "none" },
      audio: {
        input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "grok-transcribe" } },
        output: { format: { type: "audio/pcm", rate: 24000 } },
      },
    });
    s.appendAudio(new Float32Array([0.5]));
    expect(sock.types().at(-1)).toBe("input_audio_buffer.append");
  });

  it("force_message opener is sent after session.updated and never followed by response.create", async () => {
    const { sock, sink } = setup({ opener: "Quick safety check?" });
    sock.open();
    sock.server({ type: "session.updated" });
    const last = sock.sent.at(-1) as { type: string; item: Record<string, unknown> };
    expect(last.type).toBe("conversation.item.create");
    expect(last.item).toMatchObject({ type: "force_message", role: "assistant", interruptible: false });
    // server-driven lifecycle for the forced line
    sock.server({ type: "response.created", response: { id: "r0" } });
    sock.server({ type: "response.output_audio.delta", response_id: "r0", delta: AUDIO });
    sock.server({ type: "response.done", response: { id: "r0" } });
    sink.finish();
    await flush();
    expect(sock.types()).not.toContain("response.create");
    expect(sock.types().filter((t) => t === "conversation.item.create")).toHaveLength(1);
  });

  it("falls back to sending the opener if session.updated never arrives", () => {
    const { sock, timers } = setup({ opener: "Hi", openerFallbackMs: 1500 });
    sock.open();
    timers.advance(1499);
    expect(sock.types()).toEqual(["session.update"]);
    timers.advance(1);
    expect(sock.types()).toEqual(["session.update", "conversation.item.create"]);
    sock.server({ type: "session.updated" });
    expect(sock.types()).toHaveLength(2); // not sent twice
  });
});

describe("RealtimeVoiceSession: playback + barge-in", () => {
  it("plays audio deltas (both spellings) and reports speech-end → first-audio latency", () => {
    const { sock, sink, timers, latencies } = setup();
    sock.open();
    sock.server({ type: "input_audio_buffer.speech_started" });
    timers.advance(1000);
    sock.server({ type: "input_audio_buffer.speech_stopped" });
    timers.advance(640);
    sock.server({ type: "response.created", response: { id: "r1" } });
    sock.server({ type: "response.output_audio.delta", response_id: "r1", delta: AUDIO });
    sock.server({ type: "response.audio.delta", response_id: "r1", delta: AUDIO });
    expect(sink.queued).toBe(2);
    expect(latencies).toEqual([640]);
  });

  it("speech_started stops playback, clears the queue, and drops late deltas of the old response", () => {
    const { sock, sink } = setup();
    sock.open();
    sock.server({ type: "response.created", response: { id: "r1" } });
    sock.server({ type: "response.output_audio.delta", response_id: "r1", delta: AUDIO });
    sock.server({ type: "response.output_audio.delta", response_id: "r1", delta: AUDIO });
    expect(sink.isPlaying()).toBe(true);
    sock.server({ type: "input_audio_buffer.speech_started" });
    expect(sink.clears).toBe(1);
    expect(sink.isPlaying()).toBe(false);
    sock.server({ type: "response.output_audio.delta", response_id: "r1", delta: AUDIO });
    expect(sink.queued).toBe(0);
    sock.server({ type: "response.created", response: { id: "r2" } });
    sock.server({ type: "response.output_audio.delta", response_id: "r2", delta: AUDIO });
    expect(sink.queued).toBe(1);
  });
});

describe("RealtimeVoiceSession: function calls", () => {
  it("answers every call, then sends ONE response.create only after response.done and playback idle", async () => {
    const { sock, sink, toolCalls } = setup();
    sock.open();
    sock.server({ type: "response.created", response: { id: "r1" } });
    sock.server({ type: "response.output_audio.delta", response_id: "r1", delta: AUDIO });
    sock.server({ type: "response.function_call_arguments.done", name: "get_capture_status", call_id: "c1", arguments: "{}" });
    sock.server({ type: "response.function_call_arguments.done", name: "save_field_note", call_id: "c2", arguments: '{"question_id":"water_state","value":"still"}' });
    await flush();
    expect(toolCalls).toEqual(["get_capture_status", "save_field_note"]);
    const outputs = sock.sent.filter((e) => (e.item as { type?: string } | undefined)?.type === "function_call_output");
    expect(outputs.map((o) => (o.item as { call_id: string }).call_id)).toEqual(["c1", "c2"]);
    expect(sock.types()).not.toContain("response.create"); // response still streaming
    sock.server({ type: "response.done", response: { id: "r1" } });
    await flush();
    expect(sock.types()).not.toContain("response.create"); // audio still playing
    sink.finish();
    await flush();
    expect(sock.types().filter((t) => t === "response.create")).toHaveLength(1);
    // all outputs precede the response.create
    const idxCreate = sock.types().indexOf("response.create");
    const lastOutput = sock.sent.map((e) => (e.item as { type?: string } | undefined)?.type).lastIndexOf("function_call_output");
    expect(lastOutput).toBeLessThan(idxCreate);
  });

  it("waits for slow async tools before the single response.create", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { sock } = setup({
      toolHandler: async (name): Promise<ToolResult> => {
        if (name === "slow") await gate;
        return { output: {}, respond: true, endAfterPlayback: false };
      },
    });
    sock.open();
    sock.server({ type: "response.created", response: { id: "r1" } });
    sock.server({ type: "response.function_call_arguments.done", name: "slow", call_id: "c1", arguments: "{}" });
    sock.server({ type: "response.function_call_arguments.done", name: "fast", call_id: "c2", arguments: "{}" });
    sock.server({ type: "response.done", response: { id: "r1" } });
    await flush();
    expect(sock.types()).not.toContain("response.create");
    release();
    await flush();
    await flush();
    expect(sock.types().filter((t) => t === "response.create")).toHaveLength(1);
  });

  it("end_session-style tools hang up after playback without another response", async () => {
    const { s, sock, sink, ends } = setup({
      toolHandler: () => ({ output: { ended: true }, respond: false, endAfterPlayback: true }),
    });
    sock.open();
    sock.server({ type: "response.created", response: { id: "r1" } });
    sock.server({ type: "response.output_audio.delta", response_id: "r1", delta: AUDIO });
    sock.server({ type: "response.function_call_arguments.done", name: "end_session", call_id: "c1", arguments: "{}" });
    sock.server({ type: "response.done", response: { id: "r1" } });
    await flush();
    expect(s.currentStatus).toBe("open");
    sink.finish();
    await flush();
    expect(sock.types()).not.toContain("response.create");
    expect(s.currentStatus).toBe("closed");
    expect(ends).toEqual(["ended by agent"]);
  });

  it("barge-in cancels a queued follow-up (server VAD answers the user's turn instead)", async () => {
    const { sock, sink } = setup();
    sock.open();
    sock.server({ type: "response.created", response: { id: "r1" } });
    sock.server({ type: "response.output_audio.delta", response_id: "r1", delta: AUDIO });
    sock.server({ type: "response.function_call_arguments.done", name: "get_capture_status", call_id: "c1", arguments: "" });
    sock.server({ type: "response.done", response: { id: "r1" } });
    await flush();
    sock.server({ type: "input_audio_buffer.speech_started" }); // clears → idle
    await flush();
    expect(sink.queued).toBe(0);
    expect(sock.types()).not.toContain("response.create");
  });
});

describe("RealtimeVoiceSession: camera status injection", () => {
  const status = { missing: ["waterline"], hint: "Tilt down to the waterline", ready: false };

  it("debounces 1 s and sends [camera_status] + response.create with per-response instructions", () => {
    const { s, sock, timers } = setup({ cameraStatusInstructions: "One short coaching sentence." });
    sock.open();
    s.setCameraStatus(status);
    s.setCameraStatus({ ...status, hint: "Tilt down" });
    timers.advance(999);
    expect(sock.types()).toEqual(["session.update"]);
    timers.advance(1);
    const item = sock.sent[1] as { type: string; item: { role: string; content: { type: string; text: string }[] } };
    expect(item.type).toBe("conversation.item.create");
    expect(item.item.role).toBe("user");
    expect(item.item.content[0]).toEqual({
      type: "input_text",
      text: '[camera_status] {"missing":["waterline"],"hint":"Tilt down","ready":false}',
    });
    expect(sock.sent[2]).toEqual({ type: "response.create", response: { instructions: "One short coaching sentence." } });
  });

  it("never injects while the agent is speaking; flushes after the response and playback end", async () => {
    const { s, sock, sink, timers } = setup();
    sock.open();
    sock.server({ type: "response.created", response: { id: "r1" } });
    sock.server({ type: "response.output_audio.delta", response_id: "r1", delta: AUDIO });
    s.setCameraStatus(status);
    timers.advance(1000);
    expect(sock.types()).toEqual(["session.update"]);
    sock.server({ type: "response.done", response: { id: "r1" } });
    await flush();
    expect(sock.types()).toEqual(["session.update"]); // still playing
    sink.finish();
    await flush();
    expect(sock.types()).toEqual(["session.update", "conversation.item.create", "response.create"]);
  });

  it("skips duplicates of the last injected status", () => {
    const { s, sock, timers } = setup();
    sock.open();
    s.setCameraStatus(status);
    timers.advance(1000);
    const n = sock.sent.length;
    s.setCameraStatus({ ...status });
    timers.advance(2000);
    expect(sock.sent.length).toBe(n);
  });

  it("holds coaching until the user has answered the safety opener", async () => {
    const { s, sock, sink, timers } = setup({ opener: "Safety?" });
    sock.open();
    sock.server({ type: "session.updated" });
    sock.server({ type: "response.created", response: { id: "r0" } });
    sock.server({ type: "response.done", response: { id: "r0" } });
    await flush();
    s.setCameraStatus(status);
    timers.advance(1000);
    expect(sock.types()).not.toContain("response.create");
    sock.server({ type: "input_audio_buffer.speech_started" });
    sock.server({ type: "input_audio_buffer.speech_stopped" });
    sock.server({ type: "response.created", response: { id: "r1" } });
    sock.server({ type: "response.done", response: { id: "r1" } });
    sink.finish();
    await flush();
    expect(sock.types().filter((t) => t === "response.create")).toHaveLength(1);
  });
});

describe("RealtimeVoiceSession: captions", () => {
  it("builds user and assistant captions from deltas, cumulative updates, and done events", () => {
    let caps: { role: string; text: string; final: boolean }[] = [];
    const { sock } = setup({ onCaptions: (c) => (caps = c) });
    sock.open();
    sock.server({ type: "conversation.item.input_audio_transcription.updated", item_id: "u1", transcript: "hel" });
    sock.server({ type: "conversation.item.input_audio_transcription.updated", item_id: "u1", transcript: "hello" });
    sock.server({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Hello." });
    sock.server({ type: "response.audio_transcript.delta", response_id: "r1", delta: "Hi " });
    sock.server({ type: "response.output_audio_transcript.delta", response_id: "r1", delta: "there" });
    expect(caps).toEqual([
      { id: "u:u1", role: "user", text: "Hello.", final: true },
      { id: "a:r1", role: "assistant", text: "Hi there", final: false },
    ]);
  });
});
