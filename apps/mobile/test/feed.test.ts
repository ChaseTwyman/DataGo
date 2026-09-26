import type { BountySummary } from "@groundtruth/shared";
import { describe, expect, it } from "vitest";
import { countUpValue, distanceLabel, safetyLabel, sortForYou, timeLeft } from "../src/lib/feed";

const b = (id: string, match: number | null, price: number, dist = 100): BountySummary => ({
  id,
  title: id,
  summary: "",
  protocol_slug: "street-flood-depth",
  protocol_name: "Street flood depth",
  safety_level: "elevated",
  sponsor_name: null,
  sponsor_url: null,
  center_lat: 0,
  center_lng: 0,
  radius_m: 800,
  distance_m: dist,
  price_cents: price,
  surge: price / 200,
  max_surge: 5,
  ends_at: "2026-09-27T00:00:00Z",
  cells_total: 20,
  cells_needed: 18,
  paused_cells: 0,
  match_score: match,
  match_reason: null,
  budget_remaining_cents: 1000,
  example_image_url: null,
});

describe("feed helpers", () => {
  it("sorts For you by match score, then price, then distance; unscored last", () => {
    const out = sortForYou([b("a", null, 1000), b("b", 0.5, 300), b("c", 0.9, 200), b("d", 0.5, 800), b("e", 0.5, 800, 50)]);
    expect(out.map((x) => x.id)).toEqual(["c", "e", "d", "b", "a"]);
  });

  it("formats time left and distance", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(timeLeft("2026-09-26T12:45:00Z", now)).toBe("45 min left");
    expect(timeLeft("2026-09-26T15:10:00Z", now)).toBe("3 h 10 min left");
    expect(timeLeft("2026-09-26T11:00:00Z", now)).toBe("ended");
    expect(distanceLabel(20)).toBe("You're here");
    expect(distanceLabel(347)).toBe("350 m away");
    expect(distanceLabel(2345)).toBe("2.3 km away");
  });

  it("safety levels map to tones", () => {
    expect(safetyLabel("elevated").tone).toBe("warn");
    expect(safetyLabel("high").tone).toBe("bad");
    expect(safetyLabel("low").tone).toBe("ok");
  });

  it("count-up eases from → to and clamps", () => {
    expect(countUpValue(0, 1000, 0)).toBe(0);
    expect(countUpValue(0, 1000, 1)).toBe(1000);
    expect(countUpValue(0, 1000, 2)).toBe(1000);
    expect(countUpValue(0, 1000, 0.5)).toBeGreaterThan(500); // ease-out
  });
});
