import { describe, expect, it } from "vitest";
import type { StageResult } from "../src/checks";
import { decide, type DecisionInput } from "../src/decision";
import type { ReasonCode } from "../src/reasonCodes";

function stage(id: StageResult["stage"], status: StageResult["status"], codes: ReasonCode[] = []): StageResult {
  return { stage: id, label: id, status, score: null, reasonCodes: codes, evidence: [], ms: 1 };
}

const allPass = (): StageResult[] =>
  (["session_integrity", "challenge", "protocol", "authenticity", "context", "duplicates", "corroboration"] as const).map(
    (s) => stage(s, "pass"),
  );

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

function withCode(id: StageResult["stage"], code: ReasonCode): StageResult[] {
  return allPass().map((s) => (s.stage === id ? stage(id, "fail", [code]) : s));
}

describe("decide — hard fails", () => {
  const cases: [StageResult["stage"], ReasonCode, "integrity" | "context"][] = [
    ["session_integrity", "SESSION_INVALID", "integrity"],
    ["session_integrity", "SESSION_EXPIRED", "integrity"],
    ["context", "OUTSIDE_AREA", "context"],
    ["context", "OUTSIDE_WINDOW", "context"],
    ["duplicates", "DUPLICATE", "integrity"],
    ["challenge", "CHALLENGE_FAILED", "integrity"],
    ["session_integrity", "SYNTHETIC_MEDIA", "integrity"],
    ["authenticity", "C2PA_AI_GENERATED", "integrity"],
    ["authenticity", "C2PA_AI_GENERATED", "integrity"],
  ];
  for (const [st, code, kind] of cases) {
    it(`${code} rejects regardless of scores`, () => {
      const d = decide(input({ stages: withCode(st, code), protocolScore: 1, authenticityScore: 1 }));
      expect(d.status).toBe("rejected");
      expect(d.reasonCodes).toContain(code);
      expect(d.retryable).toBe(false);
      expect(d.rejectionKind).toBe(kind);
      expect(d.payoutMultiplier).toBe(0);
    });
  }

  const auth: [keyof NonNullable<DecisionInput["authenticity"]>, ReasonCode][] = [
    ["screen_recapture", "SCREEN_RECAPTURE"],
    ["printed_photo", "PRINTED_PHOTO"],
    ["ai_generated", "AI_GENERATED_SUSPECTED"],
  ];
  for (const [key, code] of auth) {
    it(`${code} at confidence >= 0.8 rejects`, () => {
      const d = decide(input({ authenticity: { [key]: { suspected: true, confidence: 0.8 } } }));
      expect(d.status).toBe("rejected");
      expect(d.reasonCodes).toContain(code);
      expect(d.rejectionKind).toBe("integrity");
    });
    it(`${code} at confidence < 0.8 caps at needs_review`, () => {
      const d = decide(input({ authenticity: { [key]: { suspected: true, confidence: 0.79 } } }));
      expect(d.status).toBe("needs_review");
      expect(d.reasonCodes).toContain(code);
    });
  }

  it("edited/composited never hard-fails but caps at needs_review", () => {
    const d = decide(input({ authenticity: { edited_or_composited: { suspected: true, confidence: 0.95 } } }));
    expect(d.status).toBe("needs_review");
    expect(d.reasonCodes).toContain("EDITED_SUSPECTED");
  });
});

describe("decide — confidence bands", () => {
  it(">= 0.75 accepts with quality multiplier", () => {
    const d = decide(input());
    expect(d.confidence).toBeGreaterThanOrEqual(0.75);
    expect(d.status).toBe("accepted");
    expect(d.payoutMultiplier).toBeCloseTo(1.16, 5);
  });
  it("0.50–0.75 needs review", () => {
    const d = decide(input({ protocolScore: 0.7, authenticityScore: 0.8, contextScore: 0.3, corroborationScore: 0.3, trustScore: 0.4 }));
    expect(d.confidence).toBeGreaterThanOrEqual(0.5);
    expect(d.confidence).toBeLessThan(0.75);
    expect(d.status).toBe("needs_review");
  });
  it("< 0.50 rejects (retryable, protocol)", () => {
    const d = decide(input({ protocolScore: 0.7, authenticityScore: 0.6, contextScore: 0, corroborationScore: 0, trustScore: 0, minAuthenticityScore: 0.5 }));
    expect(d.confidence).toBeLessThan(0.5);
    expect(d.status).toBe("rejected");
    expect(d.retryable).toBe(true);
    expect(d.reasonCodes).toContain("LOW_CONFIDENCE");
  });
  it("trust < 0.3 sends an otherwise-accepted submission to review", () => {
    const d = decide(input({ trustScore: 0.29, corroborationScore: 1 }));
    expect(d.confidence).toBeGreaterThanOrEqual(0.75);
    expect(d.status).toBe("needs_review");
    expect(d.reasonCodes).toContain("LOW_TRUST_REVIEW");
  });
  it("authenticity below protocol minimum caps at review", () => {
    const d = decide(input({ authenticityScore: 0.79, protocolScore: 1, corroborationScore: 1, trustScore: 0.9 }));
    expect(d.status).toBe("needs_review");
  });
});

describe("decide — protocol failures", () => {
  it("missing element rejects and is retryable", () => {
    const d = decide(input({ stages: withCode("protocol", "MISSING_ELEMENT:waterline") }));
    expect(d.status).toBe("rejected");
    expect(d.retryable).toBe(true);
    expect(d.rejectionKind).toBe("protocol");
    expect(d.reasonCodes).toContain("MISSING_ELEMENT:waterline");
  });
  it("protocol score below minimum rejects and is retryable", () => {
    const d = decide(input({ protocolScore: 0.69, stages: withCode("protocol", "BLURRY") }));
    expect(d.status).toBe("rejected");
    expect(d.retryable).toBe(true);
    expect(d.reasonCodes).toEqual(["BLURRY"]);
  });
});

describe("decide — errors and review caps", () => {
  it("a stage error never auto-accepts, even with perfect scores", () => {
    const stages = allPass().map((s) => (s.stage === "context" ? stage("context", "error") : s));
    const d = decide(input({ stages, protocolScore: 1, authenticityScore: 1, corroborationScore: 1, trustScore: 0.95 }));
    expect(d.status).toBe("needs_review");
    expect(d.reasonCodes).toContain("STAGE_ERROR");
  });
  it("a stage error with low scores still goes to review, not reject", () => {
    const stages = allPass().map((s) => (s.stage === "protocol" ? stage("protocol", "error") : s));
    const d = decide(input({ stages, protocolScore: 0, authenticityScore: 0 }));
    expect(d.status).toBe("needs_review");
  });
  it("hard fail beats stage error", () => {
    const stages = withCode("duplicates", "DUPLICATE").map((s) => (s.stage === "context" ? stage("context", "error") : s));
    expect(decide(input({ stages })).status).toBe("rejected");
  });
  for (const code of ["VELOCITY_LIMIT", "IMPOSSIBLE_TRAVEL"] as const) {
    it(`${code} caps at needs_review`, () => {
      const d = decide(input({ stages: withCode("duplicates", code), corroborationScore: 1, trustScore: 0.9 }));
      expect(d.status).toBe("needs_review");
      expect(d.reasonCodes).toContain(code);
    });
  }
});
