import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  PLAYBACK_STALL_MS,
  playbackStalled,
  bytesLEToInt16,
  bytesToBase64,
  ChunkBuffer,
  floatToInt16,
  floatToPcm16Base64,
  int16ToBytesLE,
  int16ToFloat,
  pcm16Base64ToFloat,
  pcm16BytesToMs,
} from "../src/voice/audio";

describe("PCM16 helpers", () => {
  it("clamps and scales float → int16 at both rails", () => {
    expect(Array.from(floatToInt16([0, 1, -1, 2, -2, 0.5]))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });

  it("int16 → float stays in [-1, 1]", () => {
    const f = int16ToFloat(new Int16Array([32767, -32768, 0]));
    expect(f[0]).toBe(1);
    expect(f[1]).toBe(-1);
    expect(f[2]).toBe(0);
  });

  it("encodes little-endian regardless of host", () => {
    const bytes = int16ToBytesLE(new Int16Array([0x0102, -2]));
    expect(Array.from(bytes)).toEqual([0x02, 0x01, 0xfe, 0xff]);
    expect(Array.from(bytesLEToInt16(bytes))).toEqual([0x0102, -2]);
  });

  it("base64 matches node's Buffer for all padding cases", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 100, 4801]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 0xff);
      const ours = bytesToBase64(bytes);
      expect(ours).toBe(Buffer.from(bytes).toString("base64"));
      expect(Array.from(base64ToBytes(ours))).toEqual(Array.from(bytes));
    }
  });

  it("round-trips float → base64 → float within one LSB", () => {
    const src = Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i / 10) * 0.8);
    const back = pcm16Base64ToFloat(floatToPcm16Base64(src));
    expect(back.length).toBe(src.length);
    for (let i = 0; i < src.length; i++) expect(Math.abs((back[i] ?? 0) - (src[i] ?? 0))).toBeLessThan(1 / 32000);
  });

  it("decodes a server delta produced by another encoder", () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(16384, 0);
    pcm.writeInt16LE(-16384, 2);
    const f = pcm16Base64ToFloat(pcm.toString("base64"));
    expect(f[0]).toBeCloseTo(0.5, 3);
    expect(f[1]).toBeCloseTo(-0.5, 3);
  });

  it("100 ms of 24 kHz PCM16 is 4800 bytes", () => {
    expect(pcm16BytesToMs(4800)).toBe(100);
  });

  it("ChunkBuffer keeps only the newest chunks", () => {
    const b = new ChunkBuffer(2);
    b.push("a");
    b.push("b");
    b.push("c");
    expect(b.drain()).toEqual(["b", "c"]);
    expect(b.size).toBe(0);
  });
});

describe("playbackStalled", () => {
  it("fires only when audio is queued and the clock has been stuck for the stall window", () => {
    expect(playbackStalled({ outstanding: 3, clockAdvancedAt: 0, now: PLAYBACK_STALL_MS })).toBe(true);
    expect(playbackStalled({ outstanding: 3, clockAdvancedAt: 0, now: PLAYBACK_STALL_MS - 1 })).toBe(false);
    expect(playbackStalled({ outstanding: 0, clockAdvancedAt: 0, now: 60_000 })).toBe(false);
  });
});
