/**
 * Native audio for the voice link, on react-native-audio-api (0.13):
 * - iOS session: playAndRecord + voiceChat (hardware echo cancellation) + defaultToSpeaker +
 *   Bluetooth HFP. (The option is `allowBluetoothHFP` in this library, not `allowBluetooth`.)
 * - Mic: AudioRecorder.onAudioReady at 24 kHz mono, ~100 ms buffers.
 * - Playback: one AudioBufferQueueSourceNode; barge-in clears and discards it. Lazy context +
 *   stall watchdog (see QueuePlayer).
 * VisionCamera is used without any audio output, so it never touches this session.
 */
import {
  AudioBufferQueueSourceNode,
  AudioContext,
  AudioManager,
  AudioRecorder,
} from "react-native-audio-api";
import { MIC_BUFFER_FRAMES, playbackStalled, VOICE_SAMPLE_RATE } from "./audio";
import type { AudioSink } from "./realtimeClient";

export function configureVoiceAudioSession(): void {
  AudioManager.setAudioSessionOptions({
    iosCategory: "playAndRecord",
    iosMode: "voiceChat",
    iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
  });
}

/**
 * `speakOnly` (verification companion): a plain playback session — no record category, so no mic
 * indicator, no permission prompt and no voice-chat DSP. Everything else: the full duplex session.
 */
export async function activateVoiceAudioSession(opts: { speakOnly?: boolean } = {}): Promise<void> {
  if (opts.speakOnly) AudioManager.setAudioSessionOptions({ iosCategory: "playback", iosMode: "spokenAudio", iosOptions: [] });
  else configureVoiceAudioSession();
  // Let the engine pause/resume across interruptions (calls, Siri, the camera) instead of dying.
  AudioManager.observeAudioInterruptions(true);
  await AudioManager.setAudioSessionActivity(true);
}

export async function deactivateVoiceAudioSession(): Promise<void> {
  try {
    await AudioManager.setAudioSessionActivity(false);
  } catch {
    /* another component may still hold it */
  }
}

/** Current output route(s), e.g. "Speaker" — for the voice diagnostics line. */
export async function outputRouteLabel(): Promise<string> {
  try {
    const info = await AudioManager.getDevicesInfo();
    return info.currentOutputs.map((d) => d.name || d.category).join(", ") || "none";
  } catch {
    return "unknown";
  }
}

export async function ensureMicPermission(): Promise<boolean> {
  const current = await AudioManager.checkRecordingPermissions();
  if (current === "Granted") return true;
  return (await AudioManager.requestRecordingPermissions()) === "Granted";
}

/** Streams mic audio as Float32 chunks. */
export class MicStream {
  private recorder: AudioRecorder | null = null;

  async start(onChunk: (samples: Float32Array) => void): Promise<void> {
    const rec = new AudioRecorder();
    this.recorder = rec;
    const r = rec.onAudioReady(
      { sampleRate: VOICE_SAMPLE_RATE, bufferLength: MIC_BUFFER_FRAMES, channelCount: 1 },
      (ev) => onChunk(ev.buffer.getChannelData(0)),
    );
    if (r.status === "error") throw new Error(`mic callback: ${r.message}`);
    const started = await rec.start();
    if (started.status === "error") throw new Error(`mic start: ${started.message}`);
  }

  async stop(): Promise<void> {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec) return;
    rec.clearOnAudioReady();
    try {
      await rec.stop();
    } catch {
      /* not recording */
    }
  }
}

export interface PlaybackStats {
  chunks: number;
  seconds: number;
  /** "none" until the first audio arrives (the context is created lazily). */
  contextState: string;
  audioClock: number;
  rebuilds: number;
  lastError: string | null;
}

const MAX_REBUILDS = 3;

/**
 * AudioSink over one AudioBufferQueueSourceNode (recreated after each barge-in). The AudioContext is
 * created on the first audio chunk — after the mic and camera have configured the session — and
 * rebuilt by a watchdog if playback stalls.
 */
export class QueuePlayer implements AudioSink {
  private ctx: AudioContext | null = null;
  private node: AudioBufferQueueSourceNode | null = null;
  private outstanding = 0;
  private waiters: (() => void)[] = [];
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastClock = -1;
  private clockAdvancedAt = 0;
  private disposed = false;
  private readonly counters = { chunks: 0, seconds: 0, rebuilds: 0, lastError: null as string | null };

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
    return this.ctx;
  }

  private ensureNode(ctx: AudioContext): AudioBufferQueueSourceNode {
    if (this.node) return this.node;
    const node = ctx.createBufferQueueSource();
    node.connect(ctx.destination);
    node.onBufferEnded = (e) => {
      if (this.node !== node) return;
      this.outstanding = e.isLastBufferInQueue ? 0 : Math.max(0, this.outstanding - 1);
      if (this.outstanding === 0) this.resolveIdle();
    };
    node.start();
    this.node = node;
    return node;
  }

  enqueue(samples: Float32Array): void {
    if (samples.length === 0 || this.disposed) return;
    const ctx = this.context();
    if (ctx.state !== "running") ctx.resume().catch((e: unknown) => this.note(e));
    const buf = ctx.createBuffer(1, samples.length, VOICE_SAMPLE_RATE);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    this.ensureNode(ctx).enqueueBuffer(buf);
    this.outstanding++;
    this.counters.chunks++;
    this.counters.seconds += samples.length / VOICE_SAMPLE_RATE;
    this.startWatchdog();
  }

  clear(): void {
    const node = this.node;
    this.node = null;
    this.outstanding = 0;
    if (node) {
      try {
        node.onBufferEnded = null;
        node.clearBuffers();
        node.stop();
        node.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.resolveIdle();
  }

  isPlaying(): boolean {
    return this.outstanding > 0;
  }

  whenIdle(): Promise<void> {
    if (this.outstanding === 0) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  stats(): PlaybackStats {
    return { ...this.counters, contextState: this.ctx?.state ?? "none", audioClock: this.ctx?.currentTime ?? 0 };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopWatchdog();
    this.clear();
    const ctx = this.ctx;
    this.ctx = null;
    try {
      await ctx?.close();
    } catch {
      /* closed */
    }
  }

  private startWatchdog(): void {
    if (this.watchdog) return;
    this.lastClock = this.ctx?.currentTime ?? 0;
    this.clockAdvancedAt = Date.now();
    this.watchdog = setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || this.outstanding === 0) return this.stopWatchdog();
      const t = ctx.currentTime;
      if (t > this.lastClock) {
        this.lastClock = t;
        this.clockAdvancedAt = Date.now();
        return;
      }
      if (playbackStalled({ outstanding: this.outstanding, clockAdvancedAt: this.clockAdvancedAt, now: Date.now() })) void this.rebuild();
    }, 500);
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  /** Drop the stalled context (the current line is lost); the next chunk starts a fresh one. */
  private async rebuild(): Promise<void> {
    this.stopWatchdog();
    if (this.counters.rebuilds >= MAX_REBUILDS) {
      this.counters.lastError = "playback stalled";
      this.clear();
      return;
    }
    this.counters.rebuilds++;
    const old = this.ctx;
    this.clear();
    this.ctx = null;
    try {
      await AudioManager.setAudioSessionActivity(true);
    } catch (e) {
      this.note(e);
    }
    try {
      await old?.close();
    } catch {
      /* closed */
    }
  }

  private note(e: unknown): void {
    this.counters.lastError = e instanceof Error ? e.message : String(e);
  }

  private resolveIdle(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
}
