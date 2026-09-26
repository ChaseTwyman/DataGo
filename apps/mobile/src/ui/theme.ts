/** Dark, map-first palette (BUILD_PROMPT §8). Status colors always pair with an icon + text. */
export const C = {
  bg: "#0B0F14",
  surface: "#131A22",
  surface2: "#1B2430",
  border: "#263241",
  text: "#E8EEF5",
  muted: "#8FA0B3",
  accent: "#3DA9FC",
  green: "#2BD576",
  amber: "#FFB020",
  red: "#FF5C5C",
  blue: "#5AA9FF",
  overlay: "rgba(11,15,20,0.82)",
} as const;

/** Minimum touch target (pt). */
export const TOUCH = 44;

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
