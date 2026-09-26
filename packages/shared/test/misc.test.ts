import { describe, expect, it } from "vitest";
import {
  buildVerificationJsonSchema,
  cellForPoint,
  cellsForCircle,
  cellsToFeatureCollection,
  circlePolygon,
  contributorMessage,
  frameCheckJsonSchema,
  frameCheckZod,
  haversineM,
  insideBountyArea,
  isFrameAllGreen,
  NEUTRAL_INTEGRITY_MESSAGE,
  parseVerification,
  pickChallenge,
  ProtocolSchema,
  reasonKind,
  ReasonCodeSchema,
  streetFloodDepth,
  updateTrust,
  type FrameCheckResult,
} from "../src";

describe("protocol", () => {
  it("flood protocol parses and has 3 elements, 3 challenges", () => {
    expect(ProtocolSchema.parse(streetFloodDepth).slug).toBe("street-flood-depth");
    expect(streetFloodDepth.capture.required_elements.map((e) => e.id)).toEqual([
      "water_surface",
      "reference_object",
      "waterline",
    ]);
    expect(streetFloodDepth.capture.challenges).toHaveLength(3);
  });
  it("pickChallenge is deterministic with injected rand", () => {
    expect(pickChallenge(streetFloodDepth, () => 0).id).toBe("step_left");
    expect(pickChallenge(streetFloodDepth, () => 0.999).id).toBe("tilt_down");
  });
});

describe("reason codes", () => {
  it("validates templated missing-element codes", () => {
    expect(ReasonCodeSchema.safeParse("MISSING_ELEMENT:waterline").success).toBe(true);
    expect(ReasonCodeSchema.safeParse("MISSING_ELEMENT:").success).toBe(false);
    expect(ReasonCodeSchema.safeParse("NOPE").success).toBe(false);
  });
  it("integrity codes get one neutral message", () => {
    expect(contributorMessage("SCREEN_RECAPTURE")).toBe(NEUTRAL_INTEGRITY_MESSAGE);
    expect(contributorMessage("DUPLICATE")).toBe(NEUTRAL_INTEGRITY_MESSAGE);
    expect(contributorMessage("MISSING_ELEMENT:waterline", "Waterline visible")).toContain("Waterline");
    expect(reasonKind("BLURRY")).toBe("protocol");
  });
});

describe("trust", () => {
  it("follows PRD §9.3 deltas and cap", () => {
    expect(updateTrust(0.5, { kind: "accepted" })).toBe(0.52);
    expect(updateTrust(0.94, { kind: "accepted" })).toBe(0.95);
    expect(updateTrust(0.5, { kind: "rejected", rejectionKind: "protocol" })).toBe(0.45);
    expect(updateTrust(0.5, { kind: "rejected", rejectionKind: "integrity" })).toBe(0.25);
    expect(updateTrust(0.1, { kind: "rejected", rejectionKind: "integrity" })).toBe(0);
    expect(updateTrust(0.5, { kind: "review_rejected", integrity: true })).toBe(0.25);
  });
});

describe("h3", () => {
  const lat = 29.7604;
  const lng = -95.3698;
  it("circle of 500 m at res 9 yields a handful of cells including the center", () => {
    const cells = cellsForCircle(lat, lng, 500);
    expect(cells.length).toBeGreaterThan(5);
    expect(cells.length).toBeLessThan(40);
    expect(cells).toContain(cellForPoint(lat, lng));
  });
  it("tiny radius still yields the center cell", () => {
    expect(cellsForCircle(lat, lng, 10)).toEqual([cellForPoint(lat, lng)]);
  });
  it("feature collection has closed [lng,lat] rings", () => {
    const fc = cellsToFeatureCollection([cellForPoint(lat, lng)], () => ({ n: 1 }));
    const ring = fc.features[0]!.geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0]![0]).toBeCloseTo(lng, 1);
    expect(fc.features[0]!.properties.n).toBe(1);
  });
  it("inside area by cell or polygon", () => {
    const cells = cellsForCircle(lat, lng, 300);
    const poly = circlePolygon(lat, lng, 300);
    expect(insideBountyArea(lat, lng, cells, poly)).toBe(true);
    expect(insideBountyArea(lat + 0.1, lng, cells, poly)).toBe(false);
  });
  it("haversine ~111 km per degree latitude", () => {
    expect(haversineM(0, 0, 1, 0) / 1000).toBeCloseTo(111.2, 0);
  });
});

describe("verification schemas", () => {
  it("frame-check JSON schema enumerates protocol element ids and is closed", () => {
    const s = frameCheckJsonSchema(streetFloodDepth) as {
      additionalProperties: boolean;
      properties: { elements: { items: { properties: { id: { enum: string[] } } } } };
    };
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.elements.items.properties.id.enum).toEqual(["water_surface", "reference_object", "waterline"]);
    expect(JSON.stringify(s)).not.toContain("$schema");
  });
  it("frame-check zod rejects unknown element ids and long hints", () => {
    const z = frameCheckZod(streetFloodDepth);
    const ok = {
      elements: [{ id: "waterline", visible: true, confidence: 0.9 }],
      framing_ok: true,
      blur_ok: true,
      lighting_ok: true,
      suspected_screen_or_print: { value: false, confidence: 0.1 },
      hint: "Hold still.",
    };
    expect(z.safeParse(ok).success).toBe(true);
    expect(z.safeParse({ ...ok, elements: [{ id: "cat", visible: true, confidence: 1 }] }).success).toBe(false);
    expect(z.safeParse({ ...ok, hint: "x".repeat(81) }).success).toBe(false);
  });
  it("verification schema embeds the protocol extraction schema, closed", () => {
    const s = buildVerificationJsonSchema(streetFloodDepth) as {
      properties: Record<string, { properties?: Record<string, unknown>; additionalProperties?: boolean; required?: string[] }>;
      required: string[];
    };
    expect(s.properties.extraction!.properties).toHaveProperty("depth_cm");
    expect(s.properties.extraction!.additionalProperties).toBe(false);
    expect(s.properties.extraction!.required).toContain("depth_cm");
    expect(s.required).toEqual(expect.arrayContaining(["challenge", "authenticity", "extraction", "protocol_score"]));
    // does not mutate the protocol
    expect(streetFloodDepth.extraction_schema).not.toHaveProperty("additionalProperties");
  });
  it("parseVerification enforces extraction required keys", () => {
    const e = { suspected: false, confidence: 0.1, evidence: "none" };
    const raw = {
      challenge: { performed: true, confidence: 0.9, evidence: "shift" },
      real_3d_scene: { value: true, confidence: 0.9, evidence: "parallax" },
      elements: [],
      quality: { blur_ok: true, lighting_ok: true, framing_ok: true },
      authenticity: { screen_recapture: e, printed_photo: e, ai_generated: e, edited_or_composited: e },
      scene: { lighting: "day", visible_weather: "overcast", internal_inconsistencies: [] },
      extraction: { depth_cm: 7, depth_confidence: 0.7, reference_object_type: "curb", surface_type: "road", water_state: "still" },
      protocol_score: 0.9,
      authenticity_score: 0.9,
      summary: "ok",
    };
    expect(parseVerification(streetFloodDepth, raw).extraction.depth_cm).toBe(7);
    expect(() => parseVerification(streetFloodDepth, { ...raw, extraction: { depth_cm: 7 } })).toThrow(/required/);
  });
  it("all-green requires every element, quality, and no screen suspicion", () => {
    const fc: FrameCheckResult = {
      elements: streetFloodDepth.capture.required_elements.map((e) => ({ id: e.id, visible: true, confidence: 0.9 })),
      framing_ok: true,
      blur_ok: true,
      lighting_ok: true,
      suspected_screen_or_print: { value: false, confidence: 0.05 },
      hint: "Hold still.",
    };
    expect(isFrameAllGreen(streetFloodDepth, fc)).toBe(true);
    expect(isFrameAllGreen(streetFloodDepth, { ...fc, suspected_screen_or_print: { value: true, confidence: 0.6 } })).toBe(false);
    expect(isFrameAllGreen(streetFloodDepth, { ...fc, elements: fc.elements.slice(1) })).toBe(false);
    expect(isFrameAllGreen(streetFloodDepth, { ...fc, blur_ok: false })).toBe(false);
  });
});
