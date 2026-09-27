/**
 * "Make it easier to get photos accepted" (2026-09-27): real, authentic cashew-jar captures were
 * rejected on a failed motion challenge, a missing secondary element (scale object), portrait vs
 * landscape framing, a daylight check that means nothing indoors, and a relevance false negative.
 * Anti-fake strength (session gate, authenticity, C2PA, duplicates) must be unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { cellForPoint, cellsForCircle, circlePolygon, DEMO, streetFloodDepth, type Protocol, type VerificationOutput } from "@groundtruth/shared";
import { mockRelevance, mockVerification } from "@/lib/grok/mocks/fixtures";
import { frameCheckSystemPrompt, relevanceSystemPrompt, verificationSystemPrompt } from "@/lib/grok/vision";
import { memorySink, runPipeline } from "@/lib/verification/pipeline";
import { isolatedDeps } from "@/lib/verification/deps";
import { burstIntervalMs } from "@/lib/verification/burstTiming";
import type { PipelineDeps, PipelineInput } from "@/lib/verification/types";
import { randomJpeg } from "./helpers";

const cells = cellsForCircle(DEMO.lat, DEMO.lng, DEMO.radiusM);
const NOON = "2026-09-26T16:00:00.000Z";
const NIGHT = "2026-09-26T07:00:00.000Z"; // 03:00 in Atlanta

/** The flood protocol reshaped like the cashew one: indoor, orientation any, a secondary element optional. */
const indoor: Protocol = {
  ...streetFloodDepth,
  capture: {
    ...streetFloodDepth.capture,
    setting: "indoor",
    orientation: "any",
    required_elements: streetFloodDepth.capture.required_elements.map((e) => (e.id === "waterline" ? { ...e, optional: true } : e)),
  },
};

async function baseInput(over: Partial<PipelineInput> = {}): Promise<PipelineInput> {
  const frames = await Promise.all([0, 1, 2].map(async (i) => ({ path: `observations/u/s/${i}.jpg`, bytes: await randomJpeg(320, 240) })));
  return {
    source: "eval",
    submissionId: null,
    userId: "00000000-0000-4000-8000-00000000cccc",
    frames,
    lat: DEMO.lat,
    lng: DEMO.lng,
    accuracy_m: 5,
    captured_at: NOON,
    received_at: NOON,
    nonce: null,
    device: { os: "ios" },
    sensors: {},
    gate: {},
    field_notes: {},
    h3_cell: cellForPoint(DEMO.lat, DEMO.lng),
    bounty: { id: DEMO.bountyId, cells, area: circlePolygon(DEMO.lat, DEMO.lng, DEMO.radiusM), starts_at: "2026-09-25T00:00:00Z", ends_at: "2026-10-05T00:00:00Z" },
    protocol: indoor,
    session: null,
    challenge: indoor.capture.challenges[0]!,
    trustScore: 0.5,
    ...over,
  };
}

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return isolatedDeps({
    demoMode: false,
    offline: false,
    now: () => new Date(),
    verify: async () => mockVerification(indoor),
    relevance: async () => mockRelevance(indoor),
    precipitationMm: async () => 22,
    alertsAt: async () => [],
    ...over,
  });
}

const stage = (r: Awaited<ReturnType<typeof runPipeline>>, id: string) => r.checks.find((c) => c.stage === id)!;

const notPerformed = (base: VerificationOutput): VerificationOutput => ({
  ...base,
  challenge: { performed: false, confidence: 0.85, evidence: "Frames are near-identical; no step closer." },
});

describe("challenge is a soft signal", () => {
  it("challenge not performed, authentic capture → accepted; stage warns, does not fail", async () => {
    const r = await runPipeline(await baseInput(), deps({ verify: async () => notPerformed(mockVerification(indoor)) }), memorySink());
    expect(stage(r, "challenge").status).toBe("warn");
    expect(stage(r, "challenge").reasonCodes).toContain("CHALLENGE_FAILED");
    expect(r.decision.status).toBe("accepted");
  });

  it("challenge not performed + weak AI suspicion → rejected (integrity)", async () => {
    const verify = async () => {
      const m = notPerformed(mockVerification(indoor));
      return { ...m, authenticity: { ...m.authenticity, ai_generated: { suspected: true, confidence: 0.6, evidence: "Over-smooth label text." } } };
    };
    const r = await runPipeline(await baseInput(), deps({ verify }), memorySink());
    expect(r.decision.status).toBe("rejected");
    expect(r.decision.rejectionKind).toBe("integrity");
    expect(r.decision.reasonCodes).toEqual(expect.arrayContaining(["CHALLENGE_FAILED", "AI_GENERATED_SUSPECTED"]));
  });

  it("challenge not performed + authenticity below the protocol minimum → rejected", async () => {
    const verify = async () => ({ ...notPerformed(mockVerification(indoor)), authenticity_score: 0.6 });
    const r = await runPipeline(await baseInput(), deps({ verify }), memorySink());
    expect(r.decision.status).toBe("rejected");
  });
});

describe("optional (secondary) elements", () => {
  it("a missing optional element warns and is still accepted", async () => {
    const verify = async () => {
      const m = mockVerification(indoor);
      return { ...m, elements: m.elements.map((e) => (e.id === "waterline" ? { ...e, present: false, confidence: 0.95, evidence: "No pen beside the jar." } : e)) };
    };
    const r = await runPipeline(await baseInput(), deps({ verify }), memorySink());
    const p = stage(r, "protocol");
    expect(p.status).toBe("warn");
    expect(p.subchecks?.find((s) => s.id === "element:waterline")?.status).toBe("warn");
    expect(r.decision.status).toBe("accepted");
  });

  it("a missing required element still rejects (retryable)", async () => {
    const verify = async () => {
      const m = mockVerification(indoor);
      return { ...m, elements: m.elements.map((e) => (e.id === "water_surface" ? { ...e, present: false, confidence: 0.95 } : e)) };
    };
    const r = await runPipeline(await baseInput(), deps({ verify }), memorySink());
    expect(r.decision.status).toBe("rejected");
    expect(r.decision.retryable).toBe(true);
  });
});

describe("indoor protocols skip the daylight check", () => {
  it("indoor at night with a day-lit image → daylight skipped, no DAYLIGHT_MISMATCH", async () => {
    const r = await runPipeline(await baseInput({ captured_at: NIGHT, received_at: NIGHT }), deps(), memorySink());
    const c = stage(r, "context");
    expect(c.subchecks?.find((s) => s.id === "daylight")?.status).toBe("skipped");
    expect(c.reasonCodes).not.toContain("DAYLIGHT_MISMATCH");
    expect(c.status).toBe("pass");
    expect(c.evidence.join(" ")).not.toMatch(/Expected lighting: night/);
  });

  it("outdoor protocols still check daylight", async () => {
    const r = await runPipeline(
      await baseInput({ protocol: streetFloodDepth, challenge: streetFloodDepth.capture.challenges[0]!, captured_at: NIGHT, received_at: NIGHT }),
      deps({ verify: async () => mockVerification(streetFloodDepth), relevance: async () => mockRelevance(streetFloodDepth) }),
      memorySink(),
    );
    expect(stage(r, "context").reasonCodes).toContain("DAYLIGHT_MISMATCH");
  });
});

describe("relevance: OFF_TOPIC only when the subject is genuinely absent", () => {
  it("off_topic verdict while the core elements are visible → not OFF_TOPIC (warn), capture accepted", async () => {
    const relevance = async () => ({
      subject_match: { value: false, confidence: 0.9 },
      elements: indoor.capture.required_elements.map((e) => ({ id: e.id, visible: e.id !== "waterline", confidence: 0.9 })),
      off_topic: { value: true, confidence: 0.8, what_it_is: "Jar of cashews on white table with earbuds" },
    });
    const r = await runPipeline(await baseInput(), deps({ relevance }), memorySink());
    expect(stage(r, "relevance").reasonCodes).not.toContain("OFF_TOPIC");
    expect(stage(r, "relevance").status).toBe("warn");
    expect(r.decision.status).toBe("accepted");
  });

  it("subject genuinely absent → OFF_TOPIC as before", async () => {
    const r = await runPipeline(await baseInput(), deps({ relevance: async () => mockRelevance(indoor, "off_topic") }), memorySink());
    expect(r.decision.reasonCodes).toContain("OFF_TOPIC");
    expect(r.decision.status).toBe("rejected");
  });
});

describe("prompts", () => {
  const ch = indoor.capture.challenges[0]!;
  it("verification prompt: orientation is not a criterion, challenge is lenient, optional elements are secondary", () => {
    const p = verificationSystemPrompt({ ...indoor, capture: { ...indoor.capture, orientation: "landscape" } }, ch, 3, 1200);
    expect(p).toMatch(/never .*framing_ok false.* portrait/i);
    expect(p).toMatch(/small/i);
    expect(p).toMatch(/performed/);
    expect(p).toMatch(/optional/i);
    expect(p).toMatch(/1200 ms/);
  });
  it("relevance prompt: a product is not off-topic per se; missing secondary elements never are", () => {
    const p = relevanceSystemPrompt(indoor);
    expect(p).not.toMatch(/an indoor object, a person's face, a product/);
    expect(p).toMatch(/missing/i);
    expect(p).toMatch(/orientation/i);
  });
  it("frame-check prompt: orientation is not a framing criterion; optional elements are marked", () => {
    const p = frameCheckSystemPrompt(indoor);
    expect(p).toMatch(/orientation/i);
    expect(p).toMatch(/waterline \(optional\)/);
  });
});

describe("burst timing sent to the model", () => {
  const at = (ms: number) => new Date(Date.parse(NOON) + ms).toISOString();

  it("median gap of the frames' captured_at", () => {
    expect(burstIntervalMs([at(0), at(1200), at(2500)], 700)).toBe(1250);
    expect(burstIntervalMs([at(0), at(1190), at(2400), at(3600)], 700)).toBe(1200);
  });
  it("falls back to the protocol value when timestamps are missing, invalid, or non-increasing", () => {
    expect(burstIntervalMs([], 700)).toBe(700);
    expect(burstIntervalMs([at(0)], 700)).toBe(700);
    expect(burstIntervalMs([at(0), null, undefined], 700)).toBe(700);
    expect(burstIntervalMs(["garbage", at(0), at(1000)], 700)).toBe(700);
    expect(burstIntervalMs([at(0), at(0), at(0)], 700)).toBe(700);
    expect(burstIntervalMs([at(1000), at(0)], 700)).toBe(700);
  });
  it("clamps absurd gaps", () => {
    expect(burstIntervalMs([at(0), at(20)], 700)).toBe(100);
    expect(burstIntervalMs([at(0), at(60_000)], 700)).toBe(5000);
  });
  it("the pipeline passes the measured spacing to the model", async () => {
    const verify = vi.fn(async (_a: { intervalMs: number }) => mockVerification(indoor));
    const input = await baseInput();
    input.frames = input.frames.map((f, i) => ({ ...f, captured_at: at(i * 1200) }));
    await runPipeline(input, deps({ verify }), memorySink());
    expect(verify.mock.calls[0]![0].intervalMs).toBe(1200);
  });
  it("without frame timestamps the protocol's frame_interval_ms is used", async () => {
    const verify = vi.fn(async (_a: { intervalMs: number }) => mockVerification(indoor));
    await runPipeline(await baseInput(), deps({ verify }), memorySink());
    expect(verify.mock.calls[0]![0].intervalMs).toBe(indoor.capture.frame_interval_ms);
  });
});
