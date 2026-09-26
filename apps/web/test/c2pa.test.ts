import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { readProvenance } from "@/lib/image/c2pa";

const grok = readFileSync(fileURLToPath(new URL("./data/grok-imagine-c2pa.jpg", import.meta.url)));

/** Minimal JPEG with one APP11 segment carrying the given payload. */
function jpegWithApp11(payload: Buffer): Buffer {
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffeb, 0);
  seg.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg, payload, Buffer.from([0xff, 0xd9])]);
}

describe("readProvenance", () => {
  it("reads the real Grok Imagine C2PA manifest as AI-generated", () => {
    const p = readProvenance(grok);
    expect(p.c2pa).toBe(true);
    expect(p.aiGenerated).toBe(true);
    expect(p.digitalSourceType).toBe("trainedAlgorithmicMedia");
    expect(p.generator).toBe("Grok Imagine");
    expect(p.source).toBe("c2pa");
  });

  it("finds nothing once the file is re-encoded (metadata stripped)", async () => {
    const stripped = await sharp(grok).jpeg({ quality: 85 }).toBuffer();
    expect(readProvenance(stripped)).toMatchObject({ c2pa: false, aiGenerated: false, generator: null });
  });

  it("does not flag a plain camera-like JPEG", async () => {
    const plain = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#777" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Make: "Apple", Model: "iPhone" } } })
      .toBuffer();
    expect(readProvenance(plain)).toMatchObject({ c2pa: false, aiGenerated: false });
  });

  it("treats a C2PA manifest with a capture source type as not AI", () => {
    const payload = Buffer.from(
      "JP\x00\x01jumbjumdc2pa digitalSourceType http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
      "latin1",
    );
    const p = readProvenance(jpegWithApp11(payload));
    expect(p).toMatchObject({ c2pa: true, aiGenerated: false, digitalSourceType: "digitalCapture" });
  });

  it("flags composite-with-AI source types", () => {
    const payload = Buffer.from(
      "JP\x00\x01jumbjumdc2pa http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia",
      "latin1",
    );
    expect(readProvenance(jpegWithApp11(payload)).aiGenerated).toBe(true);
  });

  it("flags an IPTC XMP label without a C2PA manifest", () => {
    const xmp = Buffer.from(
      '<x:xmpmeta><rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/></x:xmpmeta>',
      "latin1",
    );
    const p = readProvenance(Buffer.concat([Buffer.from([0xff, 0xd8]), xmp, Buffer.from([0xff, 0xd9])]));
    expect(p).toMatchObject({ c2pa: false, aiGenerated: true, source: "xmp" });
  });

  it("handles empty and non-image buffers", () => {
    expect(readProvenance(Buffer.alloc(0)).aiGenerated).toBe(false);
    expect(readProvenance(Buffer.from("hello")).aiGenerated).toBe(false);
  });
});
