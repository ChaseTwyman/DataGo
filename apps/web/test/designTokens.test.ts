import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLORS, contrast, CSS_VAR, TEXT_PAIRS, UI_PAIRS, type ColorToken } from "@/components/ds/tokens";

const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

function cssValue(name: string): string | undefined {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(root);
  return m?.[1]?.toLowerCase();
}

describe("design tokens", () => {
  it("contrast() matches known WCAG values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("globals.css :root carries every token with the same value", () => {
    for (const [token, value] of Object.entries(COLORS) as [ColorToken, string][]) {
      expect(cssValue(CSS_VAR[token]), `${CSS_VAR[token]} (${token})`).toBe(value.toLowerCase());
    }
  });

  it.each(TEXT_PAIRS.map(([fg, bg]) => [fg, bg]))("text %s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(COLORS[fg as ColorToken], COLORS[bg as ColorToken])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS.map(([fg, bg]) => [fg, bg]))("focus ring %s on %s is at least 3:1", (fg, bg) => {
    expect(contrast(COLORS[fg as ColorToken], COLORS[bg as ColorToken])).toBeGreaterThanOrEqual(3);
  });

  it("the input border is findable against every panel (≥ 1.5:1, decorative hairlines excluded)", () => {
    for (const bg of ["background", "card"] as const) expect(contrast(COLORS.input, COLORS[bg])).toBeGreaterThanOrEqual(1.5);
  });
});
