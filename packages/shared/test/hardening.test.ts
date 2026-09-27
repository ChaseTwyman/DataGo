/**
 * Verification hardening after the vitamin-water incident: a drink bottle submitted to a street-flood
 * bounty reached a human reviewer only because every model stage errored. These rules make the
 * outcome independent of that luck.
 */
import { describe, expect, it } from "vitest";
import { STAGES, pendingChecks, type StageResult } from "../src/checks";
import { decide, type DecisionInput } from "../src/decision";
import { checkExtraction } from "../src/extractionSanity";
import { streetFloodDepth, ProtocolSchema, type Protocol } from "../src/protocols";
import { qualityTier, verifierAfterReview, PUBLISH_MIN_CONFIDENCE } from "../src/provenance";
import { contributorMessage, reasonKind, ReasonCodeSchema, type ReasonCode } from "../src/reasonCodes";
import { isFrameAllGreen, isOffTopic, relevanceJsonSchema, relevanceZod, OFF_TOPIC_CONFIDENCE } from "../src/verificationSchema";

function stage(id: StageResult["stage"], status: StageResult["status"], codes: ReasonCode[] = []): StageResult {
  return { stage: id, label: id, status, score: null, reasonCodes: codes, evidence: [], ms: 1 };
}
const allPass = (): StageResult[] => STAGES.map((s) => stage(s.id, "pass"));
const withCode = (id: StageResult["stage"], code: ReasonCode, status: StageResult["status"] = "warn") =>
  allPass().map((s) => (s.stage === id ? stage(id, status, [code]) : s));

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    stages: allPass(),
    protocolScore: 0.9,
    authenticityScore: 0.95,
    contextScore: 1,
    corroborationScore: 0.5,
    trustScore: 0.5,
    minProtocolScore: 0.7,
    minAuthenticityScore: 0.8,
    ...over,
  };
}

describe("stage list", () => {
  it("relevance runs right after session integrity, before the reasoning-model stages", () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      "session_integrity",
      "relevance",
      "challenge",
      "protocol",
      "authenticity",
      "context",
      "duplicates",
      "corroboration",
    ]);
    expect(pendingChecks()).toHaveLength(8);
  });
});

describe("new reason codes", () => {
  it("parse and have the intended kinds", () => {
    const kinds: [ReasonCode, string][] = [
      ["OFF_TOPIC", "protocol"],
      ["EXTRACTION_MISSING", "protocol"],
      ["GATE_NOT_PASSED", "review"],
      ["EXTRACTION_IMPLAUSIBLE", "review"],
      ["EXTRACTION_LOW_CONFIDENCE", "review"],
    ];
    for (const [c, k] of kinds) {
      expect(ReasonCodeSchema.parse(c)).toBe(c);
      expect(reasonKind(c)).toBe(k);
    }
  });

  it("OFF_TOPIC tells the contributor what the bounty expected (not a neutral integrity message)", () => {
    const m = contributorMessage("OFF_TOPIC", undefined, streetFloodDepth);
    expect(m).toContain("street flood depth");
    expect(m).toContain("water surface");
    expect(m).toContain("reference object");
    expect(contributorMessage("OFF_TOPIC")).toMatch(/doesn't look like the scene/);
  });
});

describe("decide — capture gate", () => {
  it("GATE_NOT_PASSED caps a perfect capture at needs_review (no auto-accept, no auto-pay)", () => {
    const d = decide(input({ stages: withCode("session_integrity", "GATE_NOT_PASSED"), protocolScore: 1, authenticityScore: 1 }));
    expect(d.status).toBe("needs_review");
    expect(d.reasonCodes).toContain("GATE_NOT_PASSED");
  });

  it("the phone's GATE_DEGRADED claim alone is review-capped too", () => {
    const d = decide(input({ stages: withCode("session_integrity", "GATE_DEGRADED", "pass"), protocolScore: 1, authenticityScore: 1 }));
    expect(d.status).toBe("needs_review");
  });
});

describe("decide — hard protocol rejects", () => {
  it("OFF_TOPIC rejects (retryable, protocol) even when the reasoning-model stages errored", () => {
    const stages = allPass().map((s) =>
      s.stage === "relevance"
        ? stage("relevance", "fail", ["OFF_TOPIC"])
        : ["challenge", "protocol", "authenticity"].includes(s.stage)
          ? stage(s.stage, "error")
          : s,
    );
    const d = decide(input({ stages, protocolScore: 0, authenticityScore: 0 }));
    expect(d.status).toBe("rejected");
    expect(d.rejectionKind).toBe("protocol");
    expect(d.retryable).toBe(true);
    expect(d.payoutMultiplier).toBe(0);
    expect(d.reasonCodes).toContain("OFF_TOPIC");
  });

  it("OFF_TOPIC beats GATE_NOT_PASSED (reject, not review)", () => {
    const stages = allPass().map((s) =>
      s.stage === "session_integrity" ? stage(s.stage, "warn", ["GATE_NOT_PASSED", "GATE_DEGRADED"]) : s.stage === "relevance" ? stage(s.stage, "fail", ["OFF_TOPIC"]) : s,
    );
    expect(decide(input({ stages })).status).toBe("rejected");
  });

  it("integrity hard fails still win over OFF_TOPIC (non-retryable)", () => {
    const stages = allPass().map((s) =>
      s.stage === "relevance" ? stage(s.stage, "fail", ["OFF_TOPIC"]) : s.stage === "duplicates" ? stage(s.stage, "fail", ["DUPLICATE"]) : s,
    );
    const d = decide(input({ stages }));
    expect(d.retryable).toBe(false);
    expect(d.rejectionKind).toBe("integrity");
  });

  it("EXTRACTION_MISSING rejects (retryable) even with an errored stage", () => {
    const stages = withCode("protocol", "EXTRACTION_MISSING", "fail").map((s) => (s.stage === "context" ? stage("context", "error") : s));
    const d = decide(input({ stages }));
    expect(d.status).toBe("rejected");
    expect(d.retryable).toBe(true);
  });

  it("a required element confidently absent (≥ 0.8) rejects even when another stage errored", () => {
    const stages = allPass().map((s) => (s.stage === "context" ? stage("context", "error") : s));
    const d = decide(
      input({
        stages,
        elements: [
          { id: "water_surface", present: false, confidence: 0.95 },
          { id: "waterline", present: true, confidence: 0.9 },
        ],
      }),
    );
    expect(d.status).toBe("rejected");
    expect(d.rejectionKind).toBe("protocol");
    expect(d.reasonCodes).toContain("MISSING_ELEMENT:water_surface");
  });

  it("an unsure 'absent' (< 0.8) with an errored stage still goes to review, as before", () => {
    const stages = allPass().map((s) => (s.stage === "context" ? stage("context", "error") : s));
    const d = decide(input({ stages, elements: [{ id: "water_surface", present: false, confidence: 0.5 }] }));
    expect(d.status).toBe("needs_review");
  });

  it("EXTRACTION_IMPLAUSIBLE / EXTRACTION_LOW_CONFIDENCE cap at needs_review", () => {
    for (const c of ["EXTRACTION_IMPLAUSIBLE", "EXTRACTION_LOW_CONFIDENCE"] as const) {
      expect(decide(input({ stages: withCode("protocol", c), protocolScore: 1, authenticityScore: 1 })).status).toBe("needs_review");
    }
  });
});

describe("relevance schema", () => {
  it("is strict and constrains element ids to the protocol's", () => {
    const js = relevanceJsonSchema(streetFloodDepth) as { additionalProperties: boolean; required: string[] };
    expect(js.additionalProperties).toBe(false);
    expect(js.required).toEqual(["subject_match", "elements", "off_topic"]);
    const z = relevanceZod(streetFloodDepth);
    expect(() =>
      z.parse({ subject_match: { value: false, confidence: 0.9 }, elements: [{ id: "bottle", visible: true, confidence: 1 }], off_topic: { value: true, confidence: 0.9, what_it_is: "x" } }),
    ).toThrow();
  });

  it("isOffTopic needs value true and confidence ≥ 0.7", () => {
    const r = (value: boolean, confidence: number) => ({
      subject_match: { value: !value, confidence: 0.9 },
      elements: [],
      off_topic: { value, confidence, what_it_is: "a drink bottle" },
    });
    expect(isOffTopic(r(true, OFF_TOPIC_CONFIDENCE))).toBe(true);
    expect(isOffTopic(r(true, 0.69))).toBe(false);
    expect(isOffTopic(r(false, 0.99))).toBe(false);
  });

  it("isOffTopic(r, protocol): overruled when most core elements are visible (cashew false negative)", () => {
    const els = streetFloodDepth.capture.required_elements;
    const verdict = (visible: string[]) => ({
      subject_match: { value: false, confidence: 0.9 },
      elements: els.map((e) => ({ id: e.id, visible: visible.includes(e.id), confidence: 0.9 })),
      off_topic: { value: true, confidence: 0.8, what_it_is: "Jar of cashews on white table with earbuds" },
    });
    // 2 of 3 core elements visible → the subject is there; not off-topic.
    expect(isOffTopic(verdict(["water_surface", "reference_object"]), streetFloodDepth)).toBe(false);
    // 1 of 3 → still off-topic (a curb with no water is not a flood scene).
    expect(isOffTopic(verdict(["reference_object"]), streetFloodDepth)).toBe(true);
    // Optional elements don't count toward the core: with waterline optional, 1 of 2 core is not a majority.
    const withOptional = {
      ...streetFloodDepth,
      capture: { ...streetFloodDepth.capture, required_elements: els.map((e) => (e.id === "waterline" ? { ...e, optional: true } : e)) },
    };
    expect(isOffTopic(verdict(["reference_object", "waterline"]), withOptional)).toBe(true);
    // Nothing visible (the vitamin-water bottle): off-topic.
    expect(isOffTopic(verdict([]), streetFloodDepth)).toBe(true);
  });

  it("isFrameAllGreen ignores optional elements", () => {
    const els = streetFloodDepth.capture.required_elements;
    const p = { ...streetFloodDepth, capture: { ...streetFloodDepth.capture, required_elements: els.map((e) => (e.id === "waterline" ? { ...e, optional: true } : e)) } };
    const fc = {
      elements: els.filter((e) => e.id !== "waterline").map((e) => ({ id: e.id, visible: true, confidence: 0.9 })),
      framing_ok: true,
      blur_ok: true,
      lighting_ok: true,
      suspected_screen_or_print: { value: false, confidence: 0.1 },
      hint: "Hold still.",
    };
    expect(isFrameAllGreen(p, fc)).toBe(true);
    expect(isFrameAllGreen(streetFloodDepth, fc)).toBe(false);
  });
});

describe("extraction sanity (flood rules as protocol data)", () => {
  const ok = { depth_cm: 12, depth_confidence: 0.75, reference_object_assumed_height_cm: 15 };
  it("a plausible curb reading passes", () => {
    expect(checkExtraction(streetFloodDepth, ok).codes).toEqual([]);
  });
  it("null or negative depth → EXTRACTION_MISSING", () => {
    expect(checkExtraction(streetFloodDepth, { ...ok, depth_cm: null }).codes).toEqual(["EXTRACTION_MISSING"]);
    expect(checkExtraction(streetFloodDepth, { ...ok, depth_cm: -3 }).codes).toEqual(["EXTRACTION_MISSING"]);
    expect(checkExtraction(streetFloodDepth, null).codes).toContain("EXTRACTION_MISSING");
  });
  it("depth above the reference height × 1.1 → EXTRACTION_IMPLAUSIBLE", () => {
    expect(checkExtraction(streetFloodDepth, { ...ok, depth_cm: 16.5 }).codes).toEqual([]);
    expect(checkExtraction(streetFloodDepth, { ...ok, depth_cm: 17 }).codes).toEqual(["EXTRACTION_IMPLAUSIBLE"]);
  });
  it("the height rule is skipped (not failed) when the reference height is unknown", () => {
    const r = checkExtraction(streetFloodDepth, { ...ok, depth_cm: 80, reference_object_assumed_height_cm: null });
    expect(r.codes).toEqual([]);
    expect(r.findings.find((f) => f.rule.kind === "max_relative")?.applied).toBe(false);
  });
  it("depth_confidence < 0.4 → EXTRACTION_LOW_CONFIDENCE", () => {
    expect(checkExtraction(streetFloodDepth, { ...ok, depth_confidence: 0.39 }).codes).toEqual(["EXTRACTION_LOW_CONFIDENCE"]);
  });
  it("a protocol without rules has no extraction sanity codes", () => {
    const bare: Protocol = ProtocolSchema.parse({ ...streetFloodDepth, acceptance: { ...streetFloodDepth.acceptance, extraction_rules: undefined } });
    expect(checkExtraction(bare, { depth_cm: -1 }).codes).toEqual([]);
  });
  it("rules are generic: other fields and bounds work the same way", () => {
    const p: Protocol = ProtocolSchema.parse({
      ...streetFloodDepth,
      acceptance: { ...streetFloodDepth.acceptance, extraction_rules: [{ kind: "required_number", field: "count", min: 1 }] },
    });
    expect(checkExtraction(p, { count: 0 }).codes).toEqual(["EXTRACTION_MISSING"]);
    expect(checkExtraction(p, { count: 2 }).codes).toEqual([]);
  });
});

describe("publishing rules", () => {
  it("public tier: human → human_verified; model ≥ 0.75 → model_high; mock/none/low/unaccepted → null", () => {
    expect(qualityTier("accepted", "human", 0.1)).toBe("human_verified");
    expect(qualityTier("accepted", "model", PUBLISH_MIN_CONFIDENCE)).toBe("model_high");
    expect(qualityTier("accepted", "model", 0.74)).toBeNull();
    expect(qualityTier("accepted", "mock", 0.99)).toBeNull();
    expect(qualityTier("accepted", "none", 0.99)).toBeNull();
    expect(qualityTier("rejected", "human", 0.99)).toBeNull();
    expect(qualityTier("needs_review", "model", 0.99)).toBeNull();
  });
  it("a human approval never launders mock/seed rows into publishable ones", () => {
    expect(verifierAfterReview("model")).toBe("human");
    expect(verifierAfterReview("human")).toBe("human");
    expect(verifierAfterReview("mock")).toBe("mock");
    expect(verifierAfterReview("none")).toBe("none");
  });
});
