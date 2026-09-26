/**
 * Native audio for the voice link, on react-native-audio-api (0.13):
 * - iOS session: playAndRecord + voiceChat (hardware echo cancellation) + defaultToSpeaker +
 *   Bluetooth HFP. (The option is `allowBluetoothHFP` in this library, not `allowBluetooth`.)
 * - Mic: AudioRecorder.onAudioReady at 24 kHz mono, ~100 ms buffers.
 * - Playback: one AudioBufferQueueSourceNode; barge-in clears and discards it.
 * VisionCamera is used without any audio output, so it never touches this session.
 */
import {
  AudioBufferQueueSourceNode,
  AudioContext,
  AudioManager,
  AudioRecorder,
} from "react-native-audio-api";
import { MIC_BUFFER_FRAMES, VOICE_SAMPLE_RATE } from "./audio";
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
  await AudioManager.setAudioSessionActivity(true);
}

export async function deactivateVoiceAudioSession(): Promise<void> {
  try {
    await AudioManager.setAudioSessionActivity(false);
  } catch {
    /* another component may still hold it */
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

/** AudioSink over one AudioBufferQueueSourceNode (recreated after each barge-in). */
export class QueuePlayer implements AudioSink {
  private readonly ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
  private node: AudioBufferQueueSourceNode | null = null;
  private outstanding = 0;
  private waiters: (() => void)[] = [];

  private ensureNode(): AudioBufferQueueSourceNode {
    if (this.node) return this.node;
    const node = this.ctx.createBufferQueueSource();
    node.connect(this.ctx.destination);
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
    if (samples.length === 0) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const buf = this.ctx.createBuffer(1, samples.length, VOICE_SAMPLE_RATE);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    this.ensureNode().enqueueBuffer(buf);
    this.outstanding++;
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

  async dispose(): Promise<void> {
    this.clear();
    try {
      await this.ctx.close();
    } catch {
      /* closed */
    }
  }

  private resolveIdle(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
}
