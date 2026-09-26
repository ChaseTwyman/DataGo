/**
 * h3-js is compiled with Emscripten, which runs `new TextDecoder("utf-16le")` when the module loads.
 * Expo's TextDecoder polyfill (expo/src/winter) only supports UTF-8 and throws
 * `RangeError: Unknown encoding: utf-16le`, which broke every route that imports
 * @groundtruth/shared. Node's TextDecoder supports UTF-16, so the vitest suite never saw it.
 *
 * patchTextDecoder() wraps the global so UTF-16LE labels get a small decoder and every other label
 * still goes to the original implementation.
 */

type DecodeInput = ArrayBuffer | ArrayBufferView | undefined;

export class Utf16LEDecoder {
  readonly encoding = "utf-16le";
  readonly fatal = false;
  readonly ignoreBOM = false;

  decode(input?: DecodeInput): string {
    if (!input) return "";
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const units = Math.floor(bytes.length / 2);
    let out = "";
    const CHUNK = 4096;
    for (let start = 0; start < units; start += CHUNK) {
      const end = Math.min(units, start + CHUNK);
      const codes: number[] = new Array(end - start);
      for (let i = start; i < end; i++) codes[i - start] = bytes[2 * i]! | (bytes[2 * i + 1]! << 8);
      out += String.fromCharCode(...codes);
    }
    return out;
  }
}

const UTF16_LABELS = new Set(["utf-16le", "utf-16", "utf16le", "utf16", "unicode", "ucs-2", "csunicode", "iso-10646-ucs-2", "unicodefeff"]);

type DecoderCtor = new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }) => { decode(input?: DecodeInput): string };

/** Returns true when it installed the wrapper; false when there is nothing to patch. */
export function patchTextDecoder(target: { TextDecoder?: unknown }): boolean {
  const Original = target.TextDecoder as DecoderCtor | undefined;
  if (typeof Original !== "function") return false;
  if ((Original as unknown as { __utf16Patched?: boolean }).__utf16Patched) return false;
  const Base: DecoderCtor = Original; // narrowed binding for the closure below

  function PatchedTextDecoder(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }) {
    const l = String(label ?? "utf-8").trim().toLowerCase();
    if (UTF16_LABELS.has(l)) return new Utf16LEDecoder();
    return new Base(label, options);
  }
  PatchedTextDecoder.prototype = Base.prototype;
  Object.defineProperty(PatchedTextDecoder, "__utf16Patched", { value: true });

  Object.defineProperty(target, "TextDecoder", {
    value: PatchedTextDecoder,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  return true;
}
