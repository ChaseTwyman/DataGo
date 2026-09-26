/**
 * Provenance labels in image bytes: C2PA "Content Credentials" manifests and IPTC XMP
 * DigitalSourceType. Grok Imagine embeds a C2PA manifest (APP11/JUMBF in JPEG) with
 * softwareAgent "Grok Imagine" and digitalSourceType trainedAlgorithmicMedia.
 *
 * Deliberately a byte-level reader, not a C2PA validator: we never trust a label to prove an image
 * is REAL (absence proves nothing, and labels are trivially stripped), only use one that says an
 * image is AI-made. Forging an "AI" label gains an attacker nothing, so signatures don't matter here.
 */

const IPTC_PREFIX = "digitalsourcetype/";

/** IPTC digital source types that mean "made or altered by a generative model". */
const AI_SOURCE_TYPES = new Set([
  "trainedAlgorithmicMedia",
  "compositeWithTrainedAlgorithmicMedia",
  "algorithmicMedia",
  "compositeSynthetic",
]);

export interface Provenance {
  /** A C2PA manifest (JUMBF "c2pa" box) is present. */
  c2pa: boolean;
  /** Any provenance label declares the image AI-generated. */
  aiGenerated: boolean;
  /** IPTC digital source type term, e.g. "trainedAlgorithmicMedia" or "digitalCapture". */
  digitalSourceType: string | null;
  /** Generator / software agent named in the manifest, e.g. "Grok Imagine". */
  generator: string | null;
  source: "c2pa" | "xmp" | null;
}

const NONE: Provenance = { c2pa: false, aiGenerated: false, digitalSourceType: null, generator: null, source: null };

/** Concatenated APP11 payloads of a JPEG (where C2PA JUMBF lives), or null if not a JPEG. */
function jpegApp11(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts: Buffer[] = [];
  let o = 2;
  while (o + 4 <= buf.length && buf[o] === 0xff) {
    const marker = buf[o + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = buf.readUInt16BE(o + 2);
    if (len < 2) break;
    if (marker === 0xeb) parts.push(buf.subarray(o + 4, Math.min(buf.length, o + 2 + len)));
    o += 2 + len;
  }
  return Buffer.concat(parts);
}

/** Reads the CBOR text string that follows `key` (a CBOR text key) in `s`. */
function cborTextAfter(bytes: Buffer, key: string): string | null {
  const at = bytes.indexOf(key, 0, "latin1");
  if (at < 0) return null;
  let o = at + key.length;
  const head = bytes[o];
  if (head === undefined) return null;
  let len: number;
  if (head >= 0x60 && head <= 0x77) {
    len = head - 0x60;
    o += 1;
  } else if (head === 0x78 && bytes[o + 1] !== undefined) {
    len = bytes[o + 1]!;
    o += 2;
  } else {
    return null;
  }
  const text = bytes.subarray(o, o + len).toString("utf8");
  return text.length === len ? text : null;
}

function sourceTypeIn(text: string): string | null {
  const i = text.indexOf(IPTC_PREFIX);
  if (i < 0) return null;
  const m = /^[A-Za-z]+/.exec(text.slice(i + IPTC_PREFIX.length));
  return m ? m[0] : null;
}

export function readProvenance(buf: Buffer): Provenance {
  if (buf.length === 0) return NONE;

  // C2PA: JPEG APP11 segments; for other containers (PNG caBX, WebP/HEIF) fall back to the whole file.
  const app11 = jpegApp11(buf);
  const region = app11 && app11.length > 0 ? app11 : app11 === null ? buf : Buffer.alloc(0);
  const c2pa = region.includes("jumb", 0, "latin1") && region.includes("c2pa", 0, "latin1");

  if (c2pa) {
    const type = sourceTypeIn(region.toString("latin1"));
    const generator = cborTextAfter(region, "softwareAgent") ?? cborTextAfter(region, "name");
    return {
      c2pa: true,
      aiGenerated: type !== null && AI_SOURCE_TYPES.has(type),
      digitalSourceType: type,
      generator,
      source: "c2pa",
    };
  }

  // IPTC XMP (Iptc4xmpExt:DigitalSourceType) anywhere in the file.
  const text = buf.toString("latin1");
  if (text.includes("DigitalSourceType") || text.includes("digitalsourcetype")) {
    const type = sourceTypeIn(text);
    if (type) {
      return { c2pa: false, aiGenerated: AI_SOURCE_TYPES.has(type), digitalSourceType: type, generator: null, source: "xmp" };
    }
  }
  return NONE;
}
