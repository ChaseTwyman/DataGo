import sharp from "sharp";

/** FNV-1a 32-bit, for seeding. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic mock "generated" JPEG: blocky pattern seeded by the prompt, so different prompts
 * give perceptually different images (keeps dHash duplicate detection meaningful in mock mode).
 */
export async function mockImage(prompt: string, width = 640, height = 360): Promise<Buffer> {
  const rand = mulberry32(hash32(prompt));
  const block = 40;
  const raw = Buffer.alloc(width * height * 3);
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const colors: [number, number, number][] = [];
  for (let i = 0; i < cols * rows; i++) {
    colors.push([Math.floor(rand() * 255), Math.floor(rand() * 255), Math.floor(rand() * 255)]);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = colors[Math.floor(y / block) * cols + Math.floor(x / block)] ?? [0, 0, 0];
      const o = (y * width + x) * 3;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}
