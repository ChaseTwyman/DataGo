import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MODEL_FRAME_MAX_EDGE, toModelFrame } from "@/lib/image/modelFrame";

const jpeg = (width: number, height: number, orientation?: number) => {
  const img = sharp({ create: { width, height, channels: 3, background: "#4477aa" } }).jpeg();
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer();
};

describe("toModelFrame", () => {
  it("downscales a 12 MP phone-sized frame to the max edge", async () => {
    const out = await toModelFrame(await jpeg(4032, 3024));
    const m = await sharp(out).metadata();
    expect(Math.max(m.width!, m.height!)).toBe(MODEL_FRAME_MAX_EDGE);
    expect(m.width! / m.height!).toBeCloseTo(4032 / 3024, 2);
    expect(m.format).toBe("jpeg");
  });

  it("passes small upright JPEGs through untouched", async () => {
    const small = await jpeg(640, 480);
    expect((await toModelFrame(small)).equals(small)).toBe(true);
  });

  it("bakes EXIF rotation so portrait phone photos are not sent sideways", async () => {
    // Stored 400x300 landscape with orientation 6 (rotate 90° CW) = portrait 300x400 when viewed.
    const out = await toModelFrame(await jpeg(400, 300, 6));
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([300, 400]);
    expect(m.orientation ?? 1).toBe(1);
  });

  it("re-encodes non-JPEG input to JPEG", async () => {
    const png = await sharp({ create: { width: 100, height: 80, channels: 3, background: "#000" } }).png().toBuffer();
    expect((await sharp(await toModelFrame(png)).metadata()).format).toBe("jpeg");
  });
});
