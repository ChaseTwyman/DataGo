/**
 * GroundTruth web design tokens: the same mission-control palette as the phone app
 * (apps/mobile/src/ui/theme.ts). True black, white type, cool greys, hairline rules, one cold
 * accent for money and the primary action. Amber only for surge and caution. Status colours always
 * travel with an icon and a word, never alone.
 *
 * app/globals.css mirrors these values as CSS variables (--background, --card, ...). Keep the two in
 * step: test/designTokens.test.ts parses globals.css and fails if they drift, and asserts every
 * text pair below is at least 4.5:1 (WCAG AA body text).
 *
 * Pure data, no React: imported by the node test.
 */
export const COLORS = {
  background: "#000000",
  /** Panels and cards: a hair above black so hairlines and fills read as layers. */
  card: "#0B0C0E",
  /** Inputs, hover rows, skeletons. */
  surface: "#15171A",
  surface2: "#1E2126",
  hairline: "#2A2D33",
  /** Input borders: one step brighter than a hairline so fields are findable. */
  input: "#3A3F47",
  foreground: "#FFFFFF",
  /** Secondary text. */
  muted: "#8A8F98",
  /** Money and the primary action. Text on it is black. */
  accent: "#D6E4FF",
  onAccent: "#000000",
  success: "#3DDC84",
  warning: "#FFB020",
  danger: "#FF5A52",
  info: "#8AB4FF",
  onStatus: "#000000",
} as const;

export type ColorToken = keyof typeof COLORS;

/** CSS custom property that carries each token in globals.css. */
export const CSS_VAR: Record<ColorToken, string> = {
  background: "--background",
  card: "--card",
  surface: "--muted",
  surface2: "--secondary",
  hairline: "--border",
  input: "--input",
  foreground: "--foreground",
  muted: "--muted-foreground",
  accent: "--primary",
  onAccent: "--primary-foreground",
  success: "--success",
  warning: "--warning",
  danger: "--destructive",
  info: "--info",
  onStatus: "--status-foreground",
};

const BACKGROUNDS = ["background", "card", "surface", "surface2"] as const;
const FOREGROUNDS = ["foreground", "muted", "accent", "success", "warning", "danger", "info"] as const;

/** Every foreground/background pair the UI sets text in. Asserted ≥ 4.5:1. */
export const TEXT_PAIRS: readonly (readonly [fg: ColorToken, bg: ColorToken])[] = [
  ...FOREGROUNDS.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg] as const)),
  // Solid fills (primary button, destructive button, status pills with a filled background).
  ["onAccent", "accent"],
  ["onStatus", "success"],
  ["onStatus", "warning"],
  ["onStatus", "danger"],
  ["onStatus", "info"],
];

/** Non-text UI pairs (focus ring, input borders): WCAG 1.4.11 asks ≥ 3:1. */
export const UI_PAIRS: readonly (readonly [fg: ColorToken, bg: ColorToken])[] = [
  ["accent", "background"],
  ["accent", "card"],
  ["accent", "surface"],
];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => channel(parseInt(x ?? "0", 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
