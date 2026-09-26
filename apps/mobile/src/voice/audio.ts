/**
 * PCM helpers for the realtime voice link (BUILD_PROMPT §M0.5): 24 kHz mono PCM16, little-endian,
 * base64 on the wire, Float32 [-1, 1] inside react-native-audio-api. Pure TS (no RN imports) so it
 * is unit-tested under node. Base64 is implemented here because Hermes' atob/btoa availability has
 * varied across RN versions and Buffer does not exist in RN.
 */

export const VOICE_SAMPLE_RATE = 24_000;
/** ~100 ms mic buffers (BUILD_PROMPT §M0.5). */
export const MIC_BUFFER_FRAMES = 2_400;

export function floatToInt16(input: ArrayLike<number>): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function int16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = input[i] ?? 0;
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/** Int16 samples → little-endian bytes, independent of host endianness. */
export function int16ToBytesLE(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i] ?? 0, true);
  return bytes;
}

export function bytesLEToInt16(bytes: Uint8Array): Int16Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Int16Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t["-".charCodeAt(0)] = 62; // tolerate base64url
  t["_".charCodeAt(0)] = 63;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    chunk += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = (bytes[i] ?? 0) << 16;
    chunk += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + "==";
  } else if (rem === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    chunk += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + "=";
  }
  parts.push(chunk);
  return parts.join("");
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/_-]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean.charCodeAt(i)] ?? -1;
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Mic path: Float32 → PCM16 LE → base64 (for `input_audio_buffer.append`). */
export function floatToPcm16Base64(samples: ArrayLike<number>): string {
  return bytesToBase64(int16ToBytesLE(floatToInt16(samples)));
}

/** Playback path: base64 PCM16 LE (audio delta) → Float32. */
export function pcm16Base64ToFloat(b64: string): Float32Array {
  return int16ToFloat(bytesLEToInt16(base64ToBytes(b64)));
}

/** Duration in ms of `n` PCM16 bytes at the voice sample rate. */
export function pcm16BytesToMs(n: number, rate = VOICE_SAMPLE_RATE): number {
  return (n / 2 / rate) * 1000;
}

/**
 * Bounded FIFO for mic chunks captured before the socket opens (BUILD_PROMPT §M0.5: start mic and
 * socket in parallel, buffer until open). Drops the oldest chunks past `maxChunks` so a slow
 * connect never replays stale speech from many seconds ago.
 */
export class ChunkBuffer {
  private chunks: string[] = [];
  constructor(private readonly maxChunks = 50) {}
  push(chunk: string): void {
    this.chunks.push(chunk);
    if (this.chunks.length > this.maxChunks) this.chunks.splice(0, this.chunks.length - this.maxChunks);
  }
  drain(): string[] {
    const out = this.chunks;
    this.chunks = [];
    return out;
  }
  get size(): number {
    return this.chunks.length;
  }
}
