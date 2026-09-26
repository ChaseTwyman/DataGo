/**
 * Face / licence-plate redaction: pixel operations only (detection lives in lib/grok/vision.ts).
 *
 * The derivative is what researchers, the dashboard and exports see. It is produced AFTER the
 * verification decision from the original bytes; dHash, C2PA and the model always read originals.
 *
 * Boxes come from a vision model whose localisation is approximate (xAI documents no box accuracy),
 * so every box is grown by a safety margin before it is pixelated and blurred. Output is re-encoded
 * without metadata (EXIF, GPS, C2PA are dropped).
 */
import sharp from "sharp";

/** Normalised box, origin top-left of the upright (EXIF-oriented) image, all values 0..1. */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Safety margin. Measured 2026-09-26 on a street scene with 3 faces + 1 plate (grok-4.20 fast
 * vision): every object was FOUND, but boxes were off by 4–10 % of the frame (faces shifted right
 * and down, the plate shifted left), so a tight blur exposed all three faces. Asking for pixel or
 * 0–1000 coordinates gave the same offsets (the model answers in ~percent units regardless). With
 * each side grown by max(1 × the box's size, 8 % of the frame's long edge), all four were covered.
 */
export const REDACTION_MARGIN = 1.0;
export const REDACTION_MIN_PAD_FRACTION = 0.08;

/** observations/u/s/0.jpg → observations/u/s/0.redacted.jpg (sibling in the private bucket). */
export function redactedPathFor(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const stem = dot > slash ? path.slice(0, dot) : path;
  return `${stem}.redacted.jpg`;
}

export function isRedactedPath(path: string): boolean {
  return path.endsWith(".redacted.jpg");
}

/**
 * Box → clamped pixel rect, each side grown by max(margin × box size, minPad × long edge). Null if
 * the box is empty.
 */
export function toPixelRect(
  b: NormBox,
  width: number,
  height: number,
  margin = REDACTION_MARGIN,
  minPad = REDACTION_MIN_PAD_FRACTION,
): PixelRect | null {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const x = clamp01(b.x) * width;
  const y = clamp01(b.y) * height;
  const w = clamp01(b.w) * width;
  const h = clamp01(b.h) * height;
  if (w <= 0 || h <= 0) return null;
  const floor = minPad * Math.max(width, height);
  const padX = Math.max(w * margin, floor);
  const padY = Math.max(h * margin, floor);
  const left = x - padX;
  const top = y - padY;
  const right = x + w + padX;
  const bottom = y + h + padY;
  const l = Math.max(0, Math.floor(left));
  const t = Math.max(0, Math.floor(top));
  const r = Math.min(width, Math.ceil(right));
  const btm = Math.min(height, Math.ceil(bottom));
  if (r - l < 1 || btm - t < 1) return null;
  return { left: l, top: t, width: r - l, height: btm - t };
}

/** Pixelate (coarse blocks) then gaussian-blur a raw RGB region: unrecoverable, still reads as "blurred". */
async function obscure(raw: Buffer, channels: 1 | 2 | 3 | 4, rect: PixelRect): Promise<Buffer> {
  const block = Math.max(8, Math.round(Math.min(rect.width, rect.height) / 6));
  const small = await sharp(raw, { raw: { width: rect.width, height: rect.height, channels } })
    .resize(Math.max(1, Math.round(rect.width / block)), Math.max(1, Math.round(rect.height / block)), { fit: "fill", kernel: "cubic" })
    .raw()
    .toBuffer();
  const sw = Math.max(1, Math.round(rect.width / block));
  const sh = Math.max(1, Math.round(rect.height / block));
  return sharp(small, { raw: { width: sw, height: sh, channels } })
    .resize(rect.width, rect.height, { fit: "fill", kernel: "nearest" })
    .blur(Math.max(2, block / 2))
    .raw()
    .toBuffer();
}

export interface RedactResult {
  bytes: Buffer;
  width: number;
  height: number;
  rects: PixelRect[];
}

/**
 * Returns a JPEG of `bytes` (upright, metadata stripped) with every box obscured. `wholeFrame`
 * obscures everything: used when the detector reports faces/plates but returns no usable boxes.
 */
export async function redactImage(
  bytes: Buffer,
  boxes: NormBox[],
  opts: { wholeFrame?: boolean; margin?: number; minPad?: number } = {},
): Promise<RedactResult> {
  const { data, info } = await sharp(bytes).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const channels = info.channels as 1 | 2 | 3 | 4;
  const rects = opts.wholeFrame
    ? [{ left: 0, top: 0, width, height }]
    : boxes.map((b) => toPixelRect(b, width, height, opts.margin, opts.minPad)).filter((r): r is PixelRect => r !== null);
  const composites = await Promise.all(
    rects.map(async (rect) => {
      const region = await sharp(data, { raw: { width, height, channels } }).extract(rect).raw().toBuffer();
      return { input: await obscure(region, channels, rect), raw: { width: rect.width, height: rect.height, channels }, left: rect.left, top: rect.top };
    }),
  );
  const out = await sharp(data, { raw: { width, height, channels } }).composite(composites).jpeg({ quality: 85 }).toBuffer();
  return { bytes: out, width, height, rects };
}
