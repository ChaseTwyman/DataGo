import { describe, expect, it } from "vitest";
import { contrastRatio } from "../src/ui/contrast";
import {
  countdownLabel,
  distanceReadout,
  indexLabel,
  moneyParts,
  sponsorLine,
  surgeTag,
  timeLeftReadout,
  tPlus,
} from "../src/ui/telemetry";
import { C, TEXT_PAIRS } from "../src/ui/theme";

describe("telemetry readouts", () => {
  it("tPlus formats mission-elapsed time", () => {
    expect(tPlus(0)).toBe("T+00:00");
    expect(tPlus(14_400)).toBe("T+00:14");
    expect(tPlus(65_000)).toBe("T+01:05");
    expect(tPlus(3_723_000)).toBe("T+1:02:03");
    expect(tPlus(-5)).toBe("T+00:00");
  });

  it("countdownLabel counts down in whole seconds", () => {
    expect(countdownLabel(2)).toBe("T-2");
    expect(countdownLabel(0)).toBe("T-0");
    expect(countdownLabel(-1)).toBe("T-0");
  });

  it("surgeTag is uppercase with the shared multiplier format", () => {
    expect(surgeTag(5)).toBe("SURGE ×5.0");
    expect(surgeTag(1.23)).toBe("SURGE ×1.2");
  });

  it("distanceReadout splits value and unit", () => {
    expect(distanceReadout(20)).toEqual({ value: "HERE", unit: "" });
    expect(distanceReadout(423)).toEqual({ value: "420", unit: "M" });
    expect(distanceReadout(1260)).toEqual({ value: "1.3", unit: "KM" });
  });

  it("timeLeftReadout is compact and uppercase", () => {
    const now = Date.parse("2026-09-26T00:00:00Z");
    expect(timeLeftReadout("2026-09-25T23:00:00Z", now)).toBe("ENDED");
    expect(timeLeftReadout("2026-09-26T00:45:00Z", now)).toBe("45M");
    expect(timeLeftReadout("2026-09-26T02:14:00Z", now)).toBe("2H 14M");
    expect(timeLeftReadout("2026-09-29T00:00:00Z", now)).toBe("3D");
  });

  it("moneyParts splits dollars from cents for large light numerals", () => {
    expect(moneyParts(1160)).toEqual({ major: "$11", minor: ".60" });
    expect(moneyParts(5)).toEqual({ major: "$0", minor: ".05" });
    expect(moneyParts(-250)).toEqual({ major: "−$2", minor: ".50" });
  });

  it("sponsorLine shows the funder and hides when absent", () => {
    expect(sponsorLine("City of Atlanta")).toBe("FUNDED BY CITY OF ATLANTA · DATA FREE FOR EVERYONE");
    expect(sponsorLine("  ")).toBeNull();
    expect(sponsorLine(null)).toBeNull();
    expect(sponsorLine(undefined)).toBeNull();
  });

  it("indexLabel zero-pads list positions", () => {
    expect(indexLabel(0)).toBe("01");
    expect(indexLabel(11)).toBe("12");
  });
});

describe("theme contrast (WCAG AA)", () => {
  it("computes known ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("every declared text/background pair meets 4.5:1", () => {
    expect(TEXT_PAIRS.length).toBeGreaterThan(10);
    for (const [name, fg, bg] of TEXT_PAIRS) {
      const r = contrastRatio(fg, bg);
      expect(r, `${name}: ${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("backgrounds are true black", () => {
    expect(C.bg).toBe("#000000");
  });
});
