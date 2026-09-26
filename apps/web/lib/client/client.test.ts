import { describe, expect, it } from "vitest";
import { cellsForCircle, DEMO, type CellPrice, type StageResult, type SubmissionWithMedia } from "@groundtruth/shared";
import { coverageFeatures, fillColor, fillRatio, PAUSED_COLOR, summarizeCoverage } from "./coverage";
import {
  caughtBy,
  extractedRows,
  formatMs,
  formatScore,
  orderedChecks,
  parseChecksLoose,
  reasonTone,
  STAGE_STATUS_META,
} from "./checkFormat";
import { chooseStreamMode, initialStreamState, mergeSubmissions, streamReducer } from "./stream";
import { dollarsToCents, localInputToIso } from "./pricePreview";

const cell = (over: Partial<CellPrice> = {}): CellPrice => ({
  cell: "8944c0a3053ffff",
  accepted: 0,
  target: 5,
  price_cents: 1000,
  surge: 5,
  paused: false,
  paused_reason: null,
  ...over,
});

describe("coverage fill mapping", () => {
  it("clamps the fill ratio and treats a zero target as full", () => {
    expect(fillRatio(0, 5)).toBe(0);
    expect(fillRatio(4, 5)).toBeCloseTo(0.8);
    expect(fillRatio(9, 5)).toBe(1);
    expect(fillRatio(1, 0)).toBe(1);
  });

  it("maps ratio to the red → amber → green ramp", () => {
    expect(fillColor(0)).toBe("#ef4444");
    expect(fillColor(0.5)).toBe("#f59e0b");
    expect(fillColor(1)).toBe("#10b981");
    expect(fillColor(-3)).toBe("#ef4444");
    expect(fillColor(Number.NaN)).toBe("#ef4444");
    // midway between red and amber is neither endpoint
    const mid = fillColor(0.25);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(mid).not.toBe("#ef4444");
    expect(mid).not.toBe("#f59e0b");
  });

  it("builds features with color, price label, and paused styling", () => {
    const cells = cellsForCircle(DEMO.lat, DEMO.lng, 300);
    const [a, b] = cells as [string, string];
    const fc = coverageFeatures([
      cell({ cell: a, accepted: 5, price_cents: 200, surge: 1 }),
      cell({ cell: b, paused: true, paused_reason: "Flash Flood Emergency" }),
    ]);
    expect(fc.features).toHaveLength(2);
    const [fa, fb] = fc.features;
    expect(fa?.properties).toMatchObject({ cell: a, color: "#10b981", price_label: "$2.00", surge_label: "×1.0", ratio: 1 });
    expect(fb?.properties).toMatchObject({ color: PAUSED_COLOR, price_label: "PAUSED", paused: true, paused_reason: "Flash Flood Emergency" });
    expect(fa?.geometry.coordinates[0]?.length).toBeGreaterThanOrEqual(7);
  });

  it("summarizes coverage without over-counting cells past target", () => {
    const s = summarizeCoverage([
      cell({ accepted: 9, surge: 1 }),
      cell({ accepted: 0, surge: 5 }),
      cell({ paused: true, surge: 9, paused_reason: null }),
    ]);
    expect(s).toMatchObject({ cells: 3, accepted: 5, target: 15, paused: 1, maxSurge: 5, pausedReasons: ["Hazard warning"] });
  });
});

const stage = (over: Partial<StageResult>): StageResult => ({
  stage: "context",
  label: "Context plausibility",
  status: "pass",
  score: 0.9,
  reasonCodes: [],
  evidence: [],
  ms: 12,
  ...over,
});

describe("check table formatting", () => {
  it("labels waived as a visible demo waiver", () => {
    expect(STAGE_STATUS_META.waived).toEqual({ label: "waived (demo)", tone: "info" });
    expect(STAGE_STATUS_META.error.tone).toBe("danger");
  });

  it("formats scores and durations", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(0.8234)).toBe("0.82");
    expect(formatMs(0)).toBe("—");
    expect(formatMs(340.4)).toBe("340 ms");
    expect(formatMs(2340)).toBe("2.3 s");
  });

  it("orders checks by pipeline stage and fills missing stages as pending", () => {
    const out = orderedChecks([stage({ stage: "duplicates", label: "Dup" }), stage({ stage: "session_integrity", label: "S" })]);
    expect(out.map((c) => c.stage)).toEqual([
      "session_integrity",
      "relevance",
      "challenge",
      "protocol",
      "authenticity",
      "context",
      "duplicates",
      "corroboration",
    ]);
    expect(out[1]?.status).toBe("pending");
    expect(out[6]?.label).toBe("Dup");
  });

  it("parses loose red-team checks, dropping malformed entries", () => {
    const parsed = parseChecksLoose([stage({ status: "fail", reasonCodes: ["AI_GENERATED_SUSPECTED"] }), { nope: 1 }, null]);
    expect(parsed).toHaveLength(1);
    expect(caughtBy(parsed).map((c) => c.stage)).toEqual(["context"]);
  });

  it("colors reason codes by kind", () => {
    expect(reasonTone("DUPLICATE")).toBe("danger");
    expect(reasonTone("MISSING_ELEMENT:waterline")).toBe("warning");
    expect(reasonTone("DEMO_WAIVER")).toBe("info");
    expect(reasonTone("STAGE_ERROR")).toBe("progress");
    expect(reasonTone("SOMETHING_NEW")).toBe("info");
  });

  it("flattens extracted fields", () => {
    expect(extractedRows({ depth_cm: 23, ref: "curb", ok: true, x: null, conf: 0.456 })).toEqual([
      { key: "depth_cm", value: "23" },
      { key: "ref", value: "curb" },
      { key: "ok", value: "yes" },
      { key: "x", value: "—" },
      { key: "conf", value: "0.46" },
    ]);
    expect(extractedRows(null)).toEqual([]);
  });
});

const sub = (id: string, received: string, over: Partial<SubmissionWithMedia> = {}): SubmissionWithMedia => ({
  id,
  session_id: null,
  bounty_id: DEMO.bountyId,
  user_id: DEMO.researcherId,
  media: [],
  lat: DEMO.lat,
  lng: DEMO.lng,
  accuracy_m: 5,
  h3_cell: "8944c0a3053ffff",
  captured_at: received,
  received_at: received,
  status: "verifying",
  checks: [],
  reason_codes: [],
  confidence: null,
  protocol_score: null,
  authenticity_score: null,
  extracted: null,
  field_notes: null,
  payout_cents: null,
  media_urls: [],
  retryable: false,
  bounty_title: null,
  ...over,
});

const ID1 = "00000000-0000-4000-8000-00000000a001";
const ID2 = "00000000-0000-4000-8000-00000000a002";

describe("submission stream reducer", () => {
  it("sorts newest first and keeps identity of unchanged rows", () => {
    const a = sub(ID1, "2026-09-26T10:00:00Z");
    const prev = [a];
    const same = mergeSubmissions(prev, [sub(ID1, "2026-09-26T10:00:00Z", { media_urls: ["rotated"] })]);
    expect(same).toBe(prev);
    const b = sub(ID2, "2026-09-26T11:00:00Z");
    const next = mergeSubmissions(prev, [a, b]);
    expect(next.map((s) => s.id)).toEqual([ID2, ID1]);
    expect(next[1]).toBe(a);
  });

  it("replaces rows whose verification state changed", () => {
    const prev = [sub(ID1, "2026-09-26T10:00:00Z")];
    const next = mergeSubmissions(prev, [sub(ID1, "2026-09-26T10:00:00Z", { status: "accepted" })]);
    expect(next).not.toBe(prev);
    expect(next[0]?.status).toBe("accepted");
  });

  it("flags arrivals only after the first load", () => {
    let s = streamReducer(initialStreamState, { type: "loaded", submissions: [sub(ID1, "2026-09-26T10:00:00Z")], at: 1 });
    expect(s.loading).toBe(false);
    expect(s.freshIds).toEqual([]);
    s = streamReducer(s, {
      type: "loaded",
      submissions: [sub(ID1, "2026-09-26T10:00:00Z"), sub(ID2, "2026-09-26T11:00:00Z")],
      at: 2,
    });
    expect(s.freshIds).toEqual([ID2]);
    const again = streamReducer(s, { type: "loaded", submissions: s.submissions, at: 3 });
    expect(again.freshIds).toEqual([]);
    expect(again.submissions).toBe(s.submissions);
  });

  it("keeps data on error and supports optimistic removal", () => {
    let s = streamReducer(initialStreamState, { type: "loaded", submissions: [sub(ID1, "2026-09-26T10:00:00Z")], at: 1 });
    s = streamReducer(s, { type: "error", message: "boom" });
    expect(s.error).toBe("boom");
    expect(s.submissions).toHaveLength(1);
    s = streamReducer(s, { type: "remove", id: ID1 });
    expect(s.submissions).toHaveLength(0);
  });

  it("chooses realtime only when server, backend, and browser all support it", () => {
    expect(chooseStreamMode({ status: "loading" }, true)).toBeNull();
    expect(chooseStreamMode({ status: "error" }, true)).toBe("polling");
    expect(chooseStreamMode({ status: "ready", realtime: true, backend: "supabase" }, true)).toBe("realtime");
    expect(chooseStreamMode({ status: "ready", realtime: true, backend: "supabase" }, false)).toBe("polling");
    expect(chooseStreamMode({ status: "ready", realtime: true, backend: "local" }, true)).toBe("polling");
    expect(chooseStreamMode({ status: "ready", realtime: false, backend: "supabase" }, true)).toBe("polling");
  });
});

describe("data-request form helpers (prices come from POST /api/pricing/preview)", () => {
  it("parses dollar inputs and datetime-local values", () => {
    expect(dollarsToCents("2")).toBe(200);
    expect(dollarsToCents("$4.24")).toBe(424);
    expect(dollarsToCents("abc")).toBeNaN();
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-09-26T10:00")).toMatch(/^2026-09-2\dT\d\d:00:00\.000Z$/);
  });
});
