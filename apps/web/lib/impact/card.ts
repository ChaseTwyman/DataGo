/**
 * Impact cards: a shareable branded image for an accepted observation.
 *
 * Privacy by construction — the card is drawn ONLY from `ImpactFacts`, a whitelist built here:
 *   - the reading (the protocol's numeric corroboration field, e.g. depth_cm) and an enum field note
 *     (e.g. "still water"); never free text (it can name an address or a person)
 *   - the protocol name (not the request title: researchers write titles, which can name a street)
 *   - area: the H3 cell centre rounded to 0.1° (~11 km); never the capture point
 *   - date: the UTC day; never the time
 *   - fixed brand text. No photo bytes, no user id/name/email, no submission id.
 * The JPEG carries no metadata (sharp drops EXIF/XMP unless asked), and the optional background is a
 * Grok Imagine abstract image from a fixed prompt with no submission data in it, labelled on the card.
 */
import sharp from "sharp";
import { cellCenter, type FieldNotes, type Protocol } from "@groundtruth/shared";
import { fitPx, GLYPH_H, textPath } from "./pixelFont";

export const CARD_W = 1080;
export const CARD_H = 1350;
export const AI_LABEL = "BACKGROUND AI-GENERATED · GROK IMAGINE";
export const VERIFIED_LINE = "VERIFIED BY GROUNDTRUTH · CC BY 4.0 DATA";
/** Fixed prompt: no submission, place, or person data is ever sent to the image model. */
export const BACKGROUND_PROMPT =
  "Abstract dark background of flowing water ripples and topographic contour lines, deep navy and black, subtle cool blue highlights, minimal, no text, no people, no buildings, no maps, no logos.";

export interface ImpactFacts {
  /** e.g. "12 CM" (or the protocol name when there is no numeric reading). */
  headline: string;
  /** e.g. "STILL WATER" (enum field note only), or null. */
  qualifier: string | null;
  protocol: string;
  /** e.g. "33.8°N 84.4°W". */
  area: string;
  /** e.g. "SEP 26 2026". */
  date: string;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function unitFor(field: string): string {
  const m = /_(cm|mm|m|km|kg|g|c|f|pct|percent)$/.exec(field);
  if (!m) return "";
  return m[1] === "pct" || m[1] === "percent" ? "%" : ` ${m[1]!.toUpperCase()}`;
}

/** Only characters the pixel font can draw (and nothing that could smuggle markup into the SVG). */
export const cardSafe = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 .,·:\-+/°()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function impactFacts(input: {
  protocol: Protocol;
  extracted: Record<string, unknown> | null;
  fieldNotes: FieldNotes | null;
  h3Cell: string;
  capturedAt: string;
}): ImpactFacts {
  const { protocol } = input;
  const field = protocol.acceptance.corroboration_field;
  const v = field ? input.extracted?.[field] : undefined;
  const headline =
    field && typeof v === "number" && Number.isFinite(v)
      ? `${Math.round(v * 10) / 10}${unitFor(field)}`
      : protocol.name;

  let qualifier: string | null = null;
  for (const q of protocol.capture.field_questions) {
    if (q.type !== "enum") continue;
    const a = input.fieldNotes?.[q.id];
    if (typeof a !== "string" || !q.options.includes(a)) continue;
    const noun = q.id.endsWith("_state") ? ` ${q.id.slice(0, -"_state".length).replace(/_/g, " ")}` : "";
    qualifier = `${a}${noun}`;
    break;
  }

  const c = cellCenter(input.h3Cell);
  const lat = Math.round(c.lat * 10) / 10;
  const lng = Math.round(c.lng * 10) / 10;
  const area = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`;
  const d = new Date(input.capturedAt);
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
  return {
    headline: cardSafe(headline),
    qualifier: qualifier ? cardSafe(qualifier) : null,
    protocol: cardSafe(protocol.name),
    area: cardSafe(area),
    date: cardSafe(date),
  };
}

/** Every string drawn on the card (tests assert this is all the text there is). */
export function cardLines(f: ImpactFacts, aiBackground: boolean): string[] {
  return [
    "GROUNDTRUTH",
    f.protocol,
    f.headline,
    ...(f.qualifier ? [f.qualifier] : []),
    `${f.area} · ${f.date}`,
    VERIFIED_LINE,
    ...(aiBackground ? [AI_LABEL] : []),
  ];
}

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

/** Abstract hex cluster (fixed geometry: carries no location). */
function hexCluster(cx: number, cy: number, r: number): string {
  const w = Math.sqrt(3) * r;
  const ring = [
    [0, 0],
    [w, 0],
    [-w, 0],
    [w / 2, 1.5 * r],
    [-w / 2, 1.5 * r],
    [w / 2, -1.5 * r],
    [-w / 2, -1.5 * r],
  ];
  return ring
    .map(([dx, dy], i) =>
      i === 0
        ? `<polygon points="${hexPoints(cx + dx!, cy + dy!, r - 6)}" fill="#D6E4FF"/>`
        : `<polygon points="${hexPoints(cx + dx!, cy + dy!, r - 6)}" fill="none" stroke="#D6E4FF" stroke-opacity="0.35" stroke-width="3"/>`,
    )
    .join("");
}

export function cardSvg(f: ImpactFacts, aiBackground: boolean): string {
  const M = 88;
  const inner = CARD_W - 2 * M;
  const text = (s: string, x: number, y: number, px: number, fill: string, opacity = 1) =>
    `<path d="${textPath(s, x, y, px)}" fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ""}/>`;

  const headPx = fitPx(f.headline, inner, 28);
  const qualPx = f.qualifier ? fitPx(f.qualifier, inner, 11) : 0;
  const protoPx = fitPx(f.protocol, inner, 7);
  const meta = `${f.area} · ${f.date}`;
  const metaPx = fitPx(meta, inner, 6);
  const verPx = fitPx(VERIFIED_LINE, inner, 5);
  const aiPx = fitPx(AI_LABEL, inner, 3);

  const parts: string[] = [];
  parts.push(`<rect x="24" y="24" width="${CARD_W - 48}" height="${CARD_H - 48}" fill="none" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="2"/>`);
  // brand mark: hex + wordmark
  parts.push(`<polygon points="${hexPoints(M + 22, M + 22, 24)}" fill="none" stroke="#FFFFFF" stroke-width="5"/>`);
  parts.push(`<polygon points="${hexPoints(M + 22, M + 22, 9)}" fill="#D6E4FF"/>`);
  parts.push(text("GROUNDTRUTH", M + 64, M + 22 - (GLYPH_H * 6) / 2, 6, "#FFFFFF"));
  parts.push(hexCluster(CARD_W - M - 150, 350, 64));
  let y = 560;
  parts.push(text(f.protocol, M, y, protoPx, "#FFFFFF", 0.6));
  y += GLYPH_H * protoPx + 40;
  parts.push(text(f.headline, M, y, headPx, "#FFFFFF"));
  y += GLYPH_H * headPx + 44;
  if (f.qualifier) {
    parts.push(text(f.qualifier, M, y, qualPx, "#D6E4FF"));
    y += GLYPH_H * qualPx + 40;
  }
  parts.push(`<rect x="${M}" y="${CARD_H - 300}" width="${inner}" height="2" fill="#FFFFFF" fill-opacity="0.18"/>`);
  parts.push(text(meta, M, CARD_H - 250, metaPx, "#FFFFFF", 0.8));
  parts.push(text(VERIFIED_LINE, M, CARD_H - 180, verPx, "#D6E4FF"));
  if (aiBackground) parts.push(text(AI_LABEL, M, CARD_H - 110, aiPx, "#FFFFFF", 0.6));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">${parts.join("")}</svg>`;
}

/** Composes the JPEG: dark base (or a darkened AI background) + the vector card. No metadata. */
export async function composeCard(f: ImpactFacts, background: Buffer | null): Promise<Buffer> {
  const overlay = Buffer.from(cardSvg(f, background !== null));
  const base = background
    ? await sharp(background).resize(CARD_W, CARD_H, { fit: "cover" }).modulate({ brightness: 0.4 }).blur(2).toBuffer()
    : await sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: "#07080A" } }).png().toBuffer();
  return sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
