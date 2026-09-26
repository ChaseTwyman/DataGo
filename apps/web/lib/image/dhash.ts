/** Difference hash (dHash, 64 bit) via sharp. Near-duplicates have a small Hamming distance. */
import sharp from "sharp";

export const DUPLICATE_MAX_HAMMING = 6;

export async function dHash(bytes: Buffer): Promise<string> {
  const px = await sharp(bytes).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = px[y * 9 + x]!;
      const right = px[y * 9 + x + 1]!;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
