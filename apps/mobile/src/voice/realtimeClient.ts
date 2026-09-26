/**
 * Grok realtime voice session: protocol + turn-taking logic, no React and no native modules.
 * The socket, the audio sink, the clock, and the timers are injected, so the whole state machine
 * (barge-in, tool calls → single response.create after playback, force_message opener, camera
 * status injection) is unit-tested with fakes. `useGrokVoice` wires it to RN WebSocket and
 * react-native-audio-api.
 *
 * Wire facts (BUILD_PROMPT §5, docs.x.ai speech-to-speech, checked 2026-09-26):
 * - RN WebSocket takes headers as a 3rd arg: `Authorization: Bearer <ephemeral token>`.
 * - force_message produces its own response lifecycle; never follow it with response.create.
 * - All function_call_outputs must be sent before a single response.create.
 */
import { ChunkBuffer, floatToPcm16Base64, pcm16Base64ToFloat, VOICE_SAMPLE_RATE } from "./audio";
import { parseServerEvent, parseToolArgs, type ServerEvent } from "./events";
import type { RealtimeFunctionTool, ToolResult } from "./tools";

export const WS_OPEN = 1;

/** Scripted lines waiting to be spoken; older ones are dropped beyond this (captions keep them). */
export const MAX_SCRIPT_QUEUE = 3;

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
}

export type SocketFactory = (url: string, token: string) => SocketLike;

/** Where assistant audio goes. Implemented with AudioBufferQueueSourceNode on device. */
export interface AudioSink {
  enqueue(samples: Float32Array): void;
  /** Stop now and drop everything queued (barge-in). */
  clear(): void;
  isPlaying(): boolean;
  /** Resolves when everything enqueued so far has finished playing (immediately if idle). */
  whenIdle(): Promise<void>;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type VoiceStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface Caption {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface CameraStatusPayload {
  missing: string[];
  hint: string | null;
  ready: boolean;
}

export interface SessionConfig {
  instructions: string;
  tools: RealtimeFunctionTool[];
  voice?: string;
  reasoningEffort?: "none" | "high";
  /** Enable live user captions (xAI: audio.input.transcription.model = "grok-transcribe"). */
  transcribeInput?: boolean;
}

export type ToolHandler = (name: string, args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

export interface RealtimeSessionOptions {
  url: string;
  /** May be supplied later via connect(token): mic capture starts before the token arrives. */
  token?: string;
  socketFactory: SocketFactory;
  sink: AudioSink;
  session: SessionConfig;
  toolHandler?: ToolHandler;
  /** Scripted line spoken verbatim once the session is configured (force_message). */
  opener?: string;
  now?: () => number;
  timers?: Timers;
  /** ms to wait for session.updated before sending the opener anyway. */
  openerFallbackMs?: number;
  cameraStatusDebounceMs?: number;
  cameraStatusInstructions?: string;
  onStatus?: (s: VoiceStatus, detail?: string) => void;
  onCaptions?: (captions: Caption[]) => void;
  /** Speech end → first audio delta of the reply, ms. */
  onLatency?: (ms: number) => void;
  onAgentSpeaking?: (speaking: boolean) => void;
  onUnknownEvent?: (type: string, raw: unknown) => void;
  onError?: (message: string) => void;
  /** Session closed (by us, by the server, or by an end-session tool). */
  onEnd?: (reason: string) => void;
  /** Every outgoing client event type (debug overlay + tests). */
  onSend?: (type: string) => void;
  log?: (...args: unknown[]) => void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function buildSessionUpdate(cfg: SessionConfig): Record<string, unknown> {
  const input: Record<string, unknown> = { format: { type: "audio/pcm", rate: VOICE_SAMPLE_RATE } };
  if (cfg.transcribeInput) input.transcription = { model: "grok-transcribe" };
  return {
    type: "session.update",
    session: {
      voice: cfg.voice ?? "eve",
      instructions: cfg.instructions,
      turn_detection: { type: "server_vad" },
      reasoning: { effort: cfg.reasoningEffort ?? "none" },
      audio: {
        input,
        output: { format: { type: "audio/pcm", rate: VOICE_SAMPLE_RATE } },
      },
      tools: cfg.tools,
    },
  };
}

export function forceMessageEvent(text: string, interruptible = false): Record<string, unknown> {
  return {
    type: "conversation.item.create",
    item: { type: "force_message", role: "assistant", interruptible, content: [{ type: "output_text", text }] },
  };
}

export function cameraStatusText(s: CameraStatusPayload): string {
  return `[camera_status] ${JSON.stringify({ missing: s.missing, hint: s.hint, ready: s.ready })}`;
}

export class RealtimeVoiceSession {
  private socket: SocketLike | null = null;
  private status: VoiceStatus = "idle";
  private readonly micBuffer = new ChunkBuffer(50);
  private readonly now: () => number;
  private readonly timers: Timers;

  // turn-taking state
  private responseInProgress = false;
  private currentResponseId: string | null = null;
  private readonly droppedResponses = new Set<string>();
  /** We asked for a response (response.create / force_message) but have no id for it yet. */
  private awaitingResponseId = false;
  /** Barge-in happened while awaiting that id: drop the response once its id arrives. */
  private dropNextResponse = false;
  private pendingCalls = 0;
  private needFollowUp = false;
  private followUpScheduled = false;
  private endRequested = false;
  private userSpeaking = false;
  private userHasSpoken = false;
  private configured = false;
  private openerSent = false;
  private openerTimer: unknown = null;
  private speechEndAt: number | null = null;
  private closed = false;

  // camera status injection
  private pendingCamera: CameraStatusPayload | null = null;
  private lastCameraJson: string | null = null;
  private cameraTimer: unknown = null;
  private cameraDue = false;

  private captions: Caption[] = [];

  // scripted lines (verification companion): spoken verbatim via force_message, one at a time
  private readonly script: string[] = [];
  /** session.updated arrived (or the fallback timer fired): safe to speak. */
  private sessionReady = false;
  private scriptTimer: unknown = null;
  private closeAfterScript = false;

  constructor(private readonly opts: RealtimeSessionOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.timers = opts.timers ?? defaultTimers;
  }

  get currentStatus(): VoiceStatus {
    return this.status;
  }

  /** True while the agent holds the floor: a response is streaming or audio is still playing. */
  get agentSpeaking(): boolean {
    return this.responseInProgress || this.opts.sink.isPlaying();
  }

  connect(token = this.opts.token, url = this.opts.url): void {
    if (this.socket || this.closed) return;
    if (!token) throw new Error("voice token missing");
    this.setStatus("connecting");
    const ws = this.opts.socketFactory(url, token);
    this.socket = ws;
    ws.onopen = () => this.handleOpen();
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = (ev) => {
      const msg = (ev as { message?: string } | undefined)?.message ?? "socket error";
      this.opts.onError?.(msg);
      this.setStatus("error", msg);
    };
    ws.onclose = (ev) => {
      if (this.closed) return;
      this.closed = true;
      this.clearTimers();
      this.opts.sink.clear();
      this.setStatus("closed", ev.reason);
      this.opts.onEnd?.(ev.reason || `socket closed (${ev.code ?? "?"})`);
    };
  }

  /** Mic chunk (Float32, 24 kHz mono). Buffered until the socket is open and configured. */
  appendAudio(samples: ArrayLike<number>): void {
    if (this.closed) return;
    const b64 = floatToPcm16Base64(samples);
    if (this.isOpen() && this.configured) this.send({ type: "input_audio_buffer.append", audio: b64 });
    else this.micBuffer.push(b64);
  }

  /** Latest gate checklist; injected debounced, only when the agent is not speaking. */
  setCameraStatus(s: CameraStatusPayload): void {
    const json = JSON.stringify(s);
    if (json === this.lastCameraJson) {
      this.pendingCamera = null;
      if (this.cameraTimer !== null) this.timers.clearTimeout(this.cameraTimer);
      this.cameraTimer = null;
      this.cameraDue = false;
      return;
    }
    this.pendingCamera = s;
    this.cameraDue = false;
    if (this.cameraTimer !== null) this.timers.clearTimeout(this.cameraTimer);
    this.cameraTimer = this.timers.setTimeout(() => {
      this.cameraTimer = null;
      this.cameraDue = true;
      this.maybeFlushCamera();
    }, this.opts.cameraStatusDebounceMs ?? 1000);
  }

  /** Inject a tagged context message and ask for one response (e.g. capture finished). */
  injectContext(text: string, instructions?: string): void {
    if (!this.isOpen()) return;
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    this.requestResponse(instructions);
  }

  /**
   * Speak `text` verbatim (force_message) as soon as the floor is free. Lines queue in order; the
   * queue keeps only the latest few so a slow/late voice link doesn't read stale lines. Nothing is
   * ever generated from `text`.
   */
  speak(text: string): void {
    if (this.closed || !text.trim()) return;
    this.script.push(text);
    while (this.script.length > MAX_SCRIPT_QUEUE) this.script.shift();
    this.flushScript();
  }

  /** Hang up once every queued scripted line has been spoken and played (now, if none). */
  endAfterSpeech(): void {
    this.closeAfterScript = true;
    this.flushScript();
  }

  close(reason = "closed by app"): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.opts.sink.clear();
    try {
      this.socket?.close(1000, reason);
    } catch {
      /* already closed */
    }
    this.setStatus("closed", reason);
    this.opts.onEnd?.(reason);
  }

  // ---------------------------------------------------------------- internals

  private isOpen(): boolean {
    return !!this.socket && this.socket.readyState === WS_OPEN && !this.closed;
  }

  private send(ev: Record<string, unknown>): void {
    if (!this.socket || this.closed) return;
    const type = String(ev.type);
    this.opts.onSend?.(type);
    this.socket.send(JSON.stringify(ev));
  }

  private setStatus(s: VoiceStatus, detail?: string): void {
    this.status = s;
    this.opts.onStatus?.(s, detail);
  }

  private clearTimers(): void {
    if (this.cameraTimer !== null) this.timers.clearTimeout(this.cameraTimer);
    if (this.openerTimer !== null) this.timers.clearTimeout(this.openerTimer);
    if (this.scriptTimer !== null) this.timers.clearTimeout(this.scriptTimer);
    this.cameraTimer = null;
    this.openerTimer = null;
    this.scriptTimer = null;
  }

  private handleOpen(): void {
    this.setStatus("open");
    this.send(buildSessionUpdate(this.opts.session));
    this.configured = true;
    for (const chunk of this.micBuffer.drain()) this.send({ type: "input_audio_buffer.append", audio: chunk });
    if (this.opts.opener) {
      this.openerTimer = this.timers.setTimeout(() => {
        this.openerTimer = null;
        this.sendOpener();
      }, this.opts.openerFallbackMs ?? 1500);
    } else {
      this.scriptTimer = this.timers.setTimeout(() => {
        this.scriptTimer = null;
        this.sessionReady = true;
        this.flushScript();
      }, this.opts.openerFallbackMs ?? 1500);
    }
  }

  private sendOpener(): void {
    if (this.openerSent || !this.opts.opener) return;
    this.openerSent = true;
    this.sessionReady = true;
    if (this.openerTimer !== null) this.timers.clearTimeout(this.openerTimer);
    this.openerTimer = null;
    // The server runs a full response lifecycle for it; mark busy now so nothing interleaves.
    this.responseInProgress = true;
    this.awaitingResponseId = true;
    this.send(forceMessageEvent(this.opts.opener, false));
  }

  private handleMessage(data: unknown): void {
    const ev = parseServerEvent(data);
    this.dispatch(ev);
  }

  /** Exposed for tests that want to feed already-parsed events. */
  dispatch(ev: ServerEvent): void {
    switch (ev.kind) {
      case "session_updated":
        if (this.opts.opener && !this.openerSent) this.sendOpener();
        else {
          this.sessionReady = true;
          if (this.scriptTimer !== null) this.timers.clearTimeout(this.scriptTimer);
          this.scriptTimer = null;
          this.flushScript();
        }
        break;
      case "response_created":
        this.responseInProgress = true;
        this.currentResponseId = ev.responseId;
        this.awaitingResponseId = false;
        if (this.dropNextResponse && ev.responseId) this.droppedResponses.add(ev.responseId);
        this.dropNextResponse = false;
        this.opts.onAgentSpeaking?.(true);
        break;
      case "audio_delta": {
        if (ev.responseId && this.droppedResponses.has(ev.responseId)) break;
        if (this.speechEndAt !== null) {
          this.opts.onLatency?.(this.now() - this.speechEndAt);
          this.speechEndAt = null;
        }
        if (ev.delta) this.opts.sink.enqueue(pcm16Base64ToFloat(ev.delta));
        break;
      }
      case "response_done":
        if (ev.status === "failed") this.opts.onError?.("response failed");
        this.responseInProgress = false;
        this.awaitingResponseId = false;
        this.currentResponseId = null;
        this.afterResponseDone().catch((e: unknown) => this.opts.log?.("[voice] after response failed", e));
        break;
      case "assistant_transcript_delta":
        if (ev.responseId && this.droppedResponses.has(ev.responseId)) break;
        this.upsertCaption(`a:${ev.responseId ?? ev.itemId ?? "x"}`, "assistant", (t) => t + ev.delta, false);
        break;
      case "assistant_transcript_done":
        this.upsertCaption(`a:${ev.responseId ?? ev.itemId ?? "x"}`, "assistant", (t) => ev.transcript || t, true);
        break;
      case "user_transcript_delta":
        this.upsertCaption(`u:${ev.itemId ?? "x"}`, "user", (t) => t + ev.delta, false);
        break;
      case "user_transcript_partial":
        this.upsertCaption(`u:${ev.itemId ?? "x"}`, "user", () => ev.transcript, false);
        break;
      case "user_transcript_done":
        this.upsertCaption(`u:${ev.itemId ?? "x"}`, "user", (t) => ev.transcript || t, true);
        break;
      case "speech_started":
        this.handleBargeIn();
        break;
      case "speech_stopped":
        this.userSpeaking = false;
        this.userHasSpoken = true;
        this.speechEndAt = this.now();
        break;
      case "function_call":
        this.handleFunctionCall(ev.name, ev.callId, ev.arguments).catch((e: unknown) => this.opts.log?.("[voice] tool call failed", e));
        break;
      case "error":
        // A rejected response.create (e.g. "active response in progress") never gets
        // response.created/done; don't let the optimistic busy flag wedge the session.
        if (!this.currentResponseId) {
          this.responseInProgress = false;
          this.awaitingResponseId = false;
          this.dropNextResponse = false;
        }
        this.opts.onError?.(ev.message);
        // A rejected force_message must not strand the lines queued behind it.
        if (!this.responseInProgress) this.flushScript();
        this.opts.log?.("[voice] server error", ev.code, ev.message);
        break;
      case "unknown":
        this.opts.onUnknownEvent?.(ev.type, ev.raw);
        this.opts.log?.("[voice] unknown event", ev.type);
        break;
      case "invalid":
        this.opts.log?.("[voice] invalid event", ev.error);
        break;
      default:
        break;
    }
  }

  /** Barge-in: the user started talking. Stop playback, drop the queue, ignore the old response. */
  private handleBargeIn(): void {
    this.userSpeaking = true;
    this.opts.sink.clear();
    if (this.currentResponseId) this.droppedResponses.add(this.currentResponseId);
    else if (this.awaitingResponseId) this.dropNextResponse = true;
    // server_vad will answer the user's turn itself; a queued follow-up would collide with it.
    this.needFollowUp = false;
    this.opts.onAgentSpeaking?.(false);
  }

  private async handleFunctionCall(name: string, callId: string, rawArgs: string): Promise<void> {
    this.pendingCalls++;
    let result: ToolResult;
    try {
      const handler = this.opts.toolHandler;
      result = handler
        ? await handler(name, parseToolArgs(rawArgs))
        : { output: { error: "no tools" }, respond: true, endAfterPlayback: false };
    } catch (e) {
      result = {
        output: { error: e instanceof Error ? e.message : "tool failed" },
        respond: true,
        endAfterPlayback: false,
      };
    }
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result.output) },
    });
    this.pendingCalls--;
    if (result.respond) this.needFollowUp = true;
    if (result.endAfterPlayback) this.endRequested = true;
    await this.maybeFollowUp();
  }

  private async afterResponseDone(): Promise<void> {
    await this.maybeFollowUp();
    if (!this.followUpScheduled && !this.needFollowUp && this.pendingCalls === 0) {
      await this.opts.sink.whenIdle();
      if (!this.responseInProgress) this.opts.onAgentSpeaking?.(false);
      this.flushScript(); // scripted lines first; camera coaching waits for the next idle
      this.maybeFlushCamera();
    }
  }

  private canSpeakScript(): boolean {
    if (!this.isOpen() || !this.configured || !this.sessionReady) return false;
    if (this.opts.opener && !this.openerSent) return false;
    return !this.agentSpeaking && !this.userSpeaking && this.pendingCalls === 0 && !this.followUpScheduled && !this.needFollowUp;
  }

  private flushScript(): void {
    if (this.closed) return;
    if (!this.script.length) {
      if (this.closeAfterScript && !this.agentSpeaking && this.pendingCalls === 0 && !this.followUpScheduled) this.close("narration finished");
      return;
    }
    if (!this.canSpeakScript()) return; // retried after the next response_done + idle
    const text = this.script.shift() as string;
    // force_message runs its own response lifecycle; mark busy now so nothing interleaves.
    this.responseInProgress = true;
    this.awaitingResponseId = true;
    this.send(forceMessageEvent(text, true));
  }

  /**
   * After every function_call_output of a response is sent and the response itself is done, wait
   * for playback to drain and send exactly one response.create (or hang up if a tool asked to).
   */
  private async maybeFollowUp(): Promise<void> {
    if (this.closed || this.pendingCalls > 0 || this.responseInProgress || this.followUpScheduled) return;
    if (!this.needFollowUp && !this.endRequested) return;
    this.followUpScheduled = true;
    try {
      await this.opts.sink.whenIdle();
    } catch {
      /* treat a failed drain as idle */
    } finally {
      this.followUpScheduled = false;
    }
    if (this.closed || this.pendingCalls > 0 || this.responseInProgress) return;
    if (this.needFollowUp) {
      this.needFollowUp = false;
      this.requestResponse();
      return; // if endRequested, we hang up after this response finishes (next response_done)
    }
    if (this.endRequested) this.close("ended by agent");
  }

  private requestResponse(instructions?: string): void {
    this.responseInProgress = true; // optimistic, until response.created/done arrive
    this.awaitingResponseId = true;
    this.send(instructions ? { type: "response.create", response: { instructions } } : { type: "response.create" });
  }

  private canInjectCamera(): boolean {
    if (!this.isOpen() || !this.configured) return false;
    if (this.opts.opener && !this.userHasSpoken) return false; // safety check-in comes first
    return !this.agentSpeaking && !this.userSpeaking && this.pendingCalls === 0 && !this.followUpScheduled && !this.needFollowUp;
  }

  private maybeFlushCamera(): void {
    if (!this.cameraDue || !this.pendingCamera) return;
    if (!this.canInjectCamera()) return; // retried after the next response_done + idle
    const s = this.pendingCamera;
    this.pendingCamera = null;
    this.cameraDue = false;
    this.lastCameraJson = JSON.stringify(s);
    this.injectContext(
      cameraStatusText(s),
      this.opts.cameraStatusInstructions ?? "Give one short coaching sentence based on the latest camera_status.",
    );
  }

  private upsertCaption(id: string, role: Caption["role"], update: (prev: string) => string, final: boolean): void {
    const idx = this.captions.findIndex((c) => c.id === id);
    if (idx === -1) this.captions = [...this.captions, { id, role, text: update(""), final }].slice(-30);
    else {
      const prev = this.captions[idx] as Caption;
      const next = [...this.captions];
      next[idx] = { ...prev, text: update(prev.text), final: final || prev.final };
      this.captions = next;
    }
    this.opts.onCaptions?.(this.captions);
  }
}
