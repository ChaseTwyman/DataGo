/**
 * GroundTruth design tokens. Mission-control look: true black, white type, cool greys, hairlines,
 * one cold accent for money and the primary action. Amber is reserved for surge and caution.
 * Status colors always pair with an icon + text (BUILD_PROMPT §8).
 *
 * No React Native imports here: the contrast test (test/ui.test.ts) imports this file in node.
 */
export const C = {
  bg: "#000000",
  surface: "#15171A",
  surface2: "#1E2126",
  hairline: "#2A2D33",
  /** Alias of hairline, kept for older call sites. */
  border: "#2A2D33",
  text: "#FFFFFF",
  /** Secondary text. 6.4:1 on black, 5.5:1 on surface. */
  muted: "#8A8F98",
  /** Money + primary action. Text on it is black. */
  accent: "#D6E4FF",
  onAccent: "#000000",
  green: "#3DDC84",
  amber: "#FFB020",
  onAmber: "#000000",
  red: "#FF5A52",
  blue: "#8AB4FF",
  /** Scrims over camera and map. */
  overlay: "rgba(0,0,0,0.78)",
  scrim: "rgba(0,0,0,0.88)",
} as const;

/**
 * Font families, loaded in app/_layout.tsx via expo-font. Barlow / Barlow Condensed are SIL Open
 * Font License 1.1 (LICENSE_FONT in each @expo-google-fonts package). With custom
 * families never set fontWeight: the weight is the family.
 */
export const F = {
  /** Headings, labels, tab titles: condensed, set UPPERCASE with wide tracking. */
  display: "BarlowCondensed_600SemiBold",
  displayMedium: "BarlowCondensed_500Medium",
  /** Large numerals (prices, depth, latency): light weight, tabular figures. */
  numeral: "BarlowCondensed_300Light",
  numeralRegular: "BarlowCondensed_400Regular",
  body: "Barlow_400Regular",
  bodyMedium: "Barlow_500Medium",
  bodySemi: "Barlow_600SemiBold",
} as const;

/** Type scale (pt). Body never below 15. */
export const T = {
  micro: 12,
  label: 13,
  body: 16,
  bodySmall: 15,
  title: 20,
  heading: 28,
  hero: 34,
  numeral: 44,
  numeralHero: 64,
} as const;

/** Letter-spacing for uppercase condensed text. */
export const TRACK = { label: 1.6, heading: 1.2, wide: 3 } as const;

/** Minimum touch target (pt). */
export const TOUCH = 44;

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 40 } as const;

/** Mostly square corners; pills only for status. */
export const R = { sm: 2, md: 4, lg: 8, pill: 999 } as const;

/** Every foreground/background pair the UI uses for text. Asserted ≥ 4.5:1 in test/ui.test.ts. */
export const TEXT_PAIRS: readonly (readonly [name: string, fg: string, bg: string])[] = [
  ["text on bg", C.text, C.bg],
  ["text on surface", C.text, C.surface],
  ["text on surface2", C.text, C.surface2],
  ["muted on bg", C.muted, C.bg],
  ["muted on surface", C.muted, C.surface],
  ["accent on bg", C.accent, C.bg],
  ["accent on surface", C.accent, C.surface],
  ["onAccent on accent", C.onAccent, C.accent],
  ["green on bg", C.green, C.bg],
  ["green on surface", C.green, C.surface],
  ["amber on bg", C.amber, C.bg],
  ["amber on surface", C.amber, C.surface],
  ["onAmber on amber", C.onAmber, C.amber],
  ["red on bg", C.red, C.bg],
  ["red on surface", C.red, C.surface],
  ["blue on bg", C.blue, C.bg],
  ["blue on surface", C.blue, C.surface],
  ["black on white (unlocked shutter)", C.bg, C.text],
];
