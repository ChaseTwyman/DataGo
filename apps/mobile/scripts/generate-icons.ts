/**
 * Renders the GroundTruth mark to every icon/splash asset. Run from apps/mobile:
 *   pnpm icons        (= tsx scripts/generate-icons.ts)
 *
 * The mark: an H3-style hexagon cell, a level line (the "ground truth" / waterline reading) that
 * runs past the cell like a horizon, and the part of the cell below the line filled solid, like a
 * gauge. White on black, geometric, no text, so it stays legible at 29 pt.
 *
 * Outputs (assets/):
 *   icon.png           1024² opaque black background (iOS rejects alpha in the app icon)
 *   adaptive-icon.png  1024² transparent, mark inside Android's 66% safe zone (bg color in config)
 *   splash-icon.png    1024² transparent white mark (expo-splash-screen image on black)
 *   favicon.png        48² opaque
 *   mark.svg           the vector source, for reference/design reuse
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

/** Mark geometry in a 1024 box, centred; `scale` shrinks it around the centre. */
export function markSvg({ background, scale }: { background: string | null; scale: number }): string {
  const cx = 512;
  const cy = 512;
  // Flat-top hexagon. Pointy-top was tried first and read as a house outline once the level line
  // cut it; flat-top reads as a cell / gauge.
  const r = 320;
  const pts = [0, 60, 120, 180, 240, 300].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  });
  const hex = pts.join(" ");
  const stroke = 40;
  const lineY = 512; // level line through the two side vertices: a horizon across the cell
  const lineW = 28;
  const gap = 30; // black gap between the level line and the filled "ground"
  const fillTop = lineY + lineW / 2 + gap;
  const lineHalf = 430; // reaches past the hexagon's sides (≈±300 at this height) like a horizon
  const bg = background ? `<rect width="1024" height="1024" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${bg}
  <defs>
    <clipPath id="below"><rect x="0" y="${fillTop}" width="1024" height="${1024 - fillTop}"/></clipPath>
  </defs>
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">
    <polygon points="${hex}" fill="none" stroke="#FFFFFF" stroke-width="${stroke}" stroke-linejoin="miter"/>
    <polygon points="${hex}" fill="#FFFFFF" clip-path="url(#below)"/>
    <rect x="${cx - lineHalf}" y="${lineY - lineW / 2}" width="${lineHalf * 2}" height="${lineW}" fill="#FFFFFF"/>
  </g>
</svg>`;
}

async function png(svg: string, file: string, size: number, opaque: boolean) {
  let img = sharp(Buffer.from(svg)).resize(size, size);
  // flatten() removes the alpha channel entirely (App Store icon requirement).
  if (opaque) img = img.flatten({ background: "#000000" });
  await img.png({ compressionLevel: 9 }).toFile(join(OUT, file));
  const meta = await sharp(join(OUT, file)).metadata();
  console.log(`${file}: ${meta.width}x${meta.height} channels=${meta.channels} alpha=${meta.hasAlpha}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "mark.svg"), markSvg({ background: null, scale: 1 }));
  await png(markSvg({ background: "#000000", scale: 0.84 }), "icon.png", 1024, true);
  await png(markSvg({ background: null, scale: 0.6 }), "adaptive-icon.png", 1024, false);
  await png(markSvg({ background: null, scale: 1 }), "splash-icon.png", 1024, false);
  await png(markSvg({ background: "#000000", scale: 0.9 }), "favicon.png", 48, true);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
