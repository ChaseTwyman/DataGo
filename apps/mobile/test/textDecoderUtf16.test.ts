import { describe, expect, it } from "vitest";
import { patchTextDecoder, Utf16LEDecoder } from "../src/lib/textDecoderUtf16";

/** Mimics Expo's winter TextDecoder: UTF-8 only, throws on anything else (as seen on device). */
class Utf8OnlyDecoder {
  constructor(label = "utf-8") {
    const l = label.trim().toLowerCase();
    if (l !== "utf-8" && l !== "utf8") throw new RangeError(`Unknown encoding: ${label} (normalized: ${l})`);
  }
  decode(input?: ArrayBufferView | ArrayBuffer): string {
    return input ? Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : (input as Uint8Array)).toString("utf8") : "";
  }
}

describe("Utf16LEDecoder", () => {
  it("decodes little-endian UTF-16 like Node's decoder", () => {
    const s = "GroundTruth 🌊 ñ";
    const bytes = new Uint8Array(Buffer.from(s, "utf16le"));
    expect(new Utf16LEDecoder().decode(bytes)).toBe(s);
    expect(new Utf16LEDecoder().decode(bytes)).toBe(new TextDecoder("utf-16le").decode(bytes));
  });
  it("handles subarray views, ArrayBuffers, and long input", () => {
    const long = "x".repeat(10_000);
    const buf = Buffer.from("AA" + long, "utf16le");
    const view = new Uint8Array(buf.buffer, buf.byteOffset + 4, buf.byteLength - 4);
    expect(new Utf16LEDecoder().decode(view)).toBe(long);
    expect(new Utf16LEDecoder().decode(new Uint8Array(Buffer.from("hi", "utf16le")).buffer)).toBe("hi");
    expect(new Utf16LEDecoder().decode()).toBe("");
  });
});

describe("patchTextDecoder", () => {
  it("reproduces the device failure without the patch", () => {
    expect(() => new Utf8OnlyDecoder("utf-16le")).toThrow(/Unknown encoding: utf-16le/);
  });
  it("lets h3-js's `new TextDecoder('utf-16le')` succeed and keeps UTF-8 on the original", () => {
    const g: { TextDecoder?: unknown } = { TextDecoder: Utf8OnlyDecoder };
    expect(patchTextDecoder(g)).toBe(true);
    const TD = g.TextDecoder as new (label?: string) => { decode(i?: Uint8Array): string };
    expect(new TD("utf-16le").decode(new Uint8Array(Buffer.from("h3", "utf16le")))).toBe("h3");
    const utf8 = new TD("utf-8");
    expect(utf8).toBeInstanceOf(Utf8OnlyDecoder);
    expect(utf8.decode(new Uint8Array(Buffer.from("ok")))).toBe("ok");
    expect(() => new TD("latin2")).toThrow(RangeError);
  });
  it("is idempotent and no-ops without a TextDecoder", () => {
    const g: { TextDecoder?: unknown } = { TextDecoder: Utf8OnlyDecoder };
    patchTextDecoder(g);
    expect(patchTextDecoder(g)).toBe(false);
    expect(patchTextDecoder({})).toBe(false);
  });
});
