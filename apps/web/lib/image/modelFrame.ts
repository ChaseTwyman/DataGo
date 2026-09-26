/**
 * Prepares a burst frame for the grok-4.7 verification call. Phone photos are ~12 MP / 3-5 MB each
 * and three are sent per call; on Vercel that call exceeded 60 s (twice, with the SDK retry) while
 * 1536 px is ample to judge depth against a curb and to spot recapture/compositing.
 *
 * Only the model sees the resized copy. Provenance (C2PA) and dHash duplicate checks keep reading
 * the original bytes, so resizing (which drops metadata) never weakens them.
 */
import sharp from "sharp";

export const MODEL_FRAME_MAX_EDGE = 1536;

export async function toModelFrame(bytes: Buffer, maxEdge = MODEL_FRAME_MAX_EDGE): Promise<Buffer> {
  const meta = await sharp(bytes).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const oriented = (meta.orientation ?? 1) !== 1;
  if (meta.format === "jpeg" && Math.max(w, h) <= maxEdge && !oriented) return bytes;
  return sharp(bytes)
    .rotate() // bake EXIF orientation before metadata is dropped
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}
