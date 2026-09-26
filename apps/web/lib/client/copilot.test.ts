import { describe, expect, it } from "vitest";
import { cellText, chartSeries, LenientCopilotAnswerSchema, mapCells, resultCsv, type AskResult } from "./copilot";

const grouped: AskResult = {
  columns: [
    { name: "surface_type", label: "surface type", type: "string" },
    { name: "median_depth_cm", label: "Median depth cm", type: "number" },
    { name: "count", label: "count", type: "number" },
  ],
  rows: [
    { surface_type: "road", median_depth_cm: 48.5, count: 4 },
    { surface_type: "sidewalk", median_depth_cm: null, count: 1 },
    { surface_type: "=HYPERLINK(\"x\")", median_depth_cm: 3, count: 1 },
  ],
  total_rows: 3,
  truncated: false,
  observations_matched: 6,
  observations_in_scope: 6,
};

describe("ask-the-data client helpers", () => {
  it("bar series: key = first non-numeric column, value = first numeric; null values skipped, not zeroed", () => {
    const s = chartSeries(grouped, "bar")!;
    expect(s.labels).toEqual(["road", "=HYPERLINK(\"x\")"]);
    expect(s.values).toEqual([48.5, 3]);
    expect(s.valueLabel).toBe("Median depth cm");
    expect(chartSeries(grouped, "table")).toBeNull();
  });

  it("line series is time-ordered", () => {
    const r: AskResult = {
      ...grouped,
      columns: [
        { name: "hour", label: "hour", type: "datetime" },
        { name: "count", label: "Count", type: "number" },
      ],
      rows: [
        { hour: "2026-09-26T14:00:00Z", count: 2 },
        { hour: "2026-09-26T12:00:00Z", count: 5 },
      ],
    };
    expect(chartSeries(r, "line")!.values).toEqual([5, 2]);
  });

  it("map cells sum counts per cell and keep zero-observation cells", () => {
    const r: AskResult = {
      ...grouped,
      columns: [
        { name: "h3_cell", label: "h3 cell", type: "string" },
        { name: "observations", label: "observations", type: "number" },
      ],
      rows: [
        { h3_cell: "892a8a", observations: 0 },
        { h3_cell: "892a8b", observations: 3 },
      ],
    };
    expect(mapCells(r)).toEqual([
      { h3_cell: "892a8a", rows: 0 },
      { h3_cell: "892a8b", rows: 3 },
    ]);
    expect(mapCells(grouped)).toEqual([]);
  });

  it("CSV neutralises formulas and quotes", () => {
    const csv = resultCsv(grouped);
    expect(csv.split("\r\n")[0]).toBe("surface_type,median_depth_cm,count");
    expect(csv).toContain(`"'=HYPERLINK(""x"")",3,1`);
    expect(csv).toContain("sidewalk,,1");
  });

  it("cell text", () => {
    expect(cellText(null)).toBe("—");
    expect(cellText(48.456)).toBe("48.46");
    expect(cellText(true)).toBe("yes");
    expect(cellText("2026-09-26T14:05:00Z", "datetime")).toBe("2026-09-26 14:05 UTC");
  });

  it("lenient parse keeps a refusal readable and drops unknown chart types to a string", () => {
    const a = LenientCopilotAnswerSchema.parse({ status: "refused", question: "q", refusal: "nope", chart: 7, plan_steps: null });
    expect(a.status).toBe("refused");
    expect(a.chart).toBe("table");
    expect(a.plan_steps).toEqual([]);
    expect(a.result).toBeNull();
  });
});
