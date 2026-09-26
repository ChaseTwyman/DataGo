/** Unit tests for the verification stages and runner, with fake deps (no DB, no network). */
import { describe, expect, it, vi } from "vitest";
import { cellForPoint, cellsForCircle, circlePolygon, DEMO, streetFloodDepth, type VerificationOutput } from "@groundtruth/shared";
import { mockVerification } from "@/lib/grok/mocks/fixtures";
import { memorySink, runPipeline } from "@/lib/verification/pipeline";
import { isolatedDeps } from "@/lib/verification/deps";
import { assertObservationPaths, SyntheticMediaError } from "@/lib/verification/syntheticGuard";
import type { PipelineDeps, PipelineInput } from "@/lib/verification/types";
import { dHash, hamming } from "@/lib/image/dhash";
import { expectedLighting } from "@/lib/context/daylight";
import { sumPrecipitation } from "@/lib/context/openMeteo";
import { parseNwsAlerts, pointInAlert } from "@/lib/context/nws";
import { randomJpeg } from "./helpers";

const cells = cellsForCircle(DEMO.lat, DEMO.lng, DEMO.radiusM);
// Noon-ish local time in Atlanta (16:00Z) so daylight is "day" regardless of when tests run.
const NOON = "2026-09-26T16:00:00.000Z";

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
    protocol: streetFloodDepth,
    session: null,
    challenge: streetFloodDepth.capture.challenges[0]!,
    trustScore: 0.5,
    ...over,
  };
}

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return isolatedDeps({
    demoMode: false,
    offline: false,
    now: () => new Date(),
    verify: async () => mockVerification(streetFloodDepth),
    precipitationMm: async () => 22,
    alertsAt: async () => [],
    ...over,
  });
}

const stage = (r: Awaited<ReturnType<typeof runPipeline>>, id: string) => r.checks.find((c) => c.stage === id)!;

describe("runPipeline", () => {
  it("genuine capture → accepted; every stage written running then final", async () => {
    const sink = memorySink();
    const r = await runPipeline(await baseInput(), deps(), sink);
    expect(r.decision.status).toBe("accepted");
    expect(stage(r, "session_integrity").status).toBe("skipped");
    expect(r.phashes).toHaveLength(3);
    // pending snapshot + (running, done) per stage
    expect(sink.history).toHaveLength(1 + 7 * 2);
    expect(sink.history[1]![0]!.status).toBe("running");
    expect(r.checks.every((c) => c.ms >= 0)).toBe(true);
  });

  it("one model call serves challenge/protocol/authenticity/context/corroboration", async () => {
    const verify = vi.fn(async () => mockVerification(streetFloodDepth));
    await runPipeline(await baseInput(), deps({ verify }), memorySink());
    expect(verify).toHaveBeenCalledTimes(1);
    expect((verify.mock.calls[0] as unknown as [{ framesBase64: string[] }])[0].framesBase64).toHaveLength(3);
  });

  it("identical burst frames → CHALLENGE_FAILED even when the model is fooled", async () => {
    const one = await randomJpeg(320, 240);
    const input = await baseInput({ frames: [0, 1, 2].map((i) => ({ path: `x/${i}.jpg`, bytes: one })) });
    const r = await runPipeline(input, deps(), memorySink());
    expect(r.decision.status).toBe("rejected");
    expect(stage(r, "challenge").reasonCodes).toContain("CHALLENGE_FAILED");
  });

  it("AI-generated verdict → rejected (integrity)", async () => {
    const r = await runPipeline(await baseInput(), deps({ verify: async () => mockVerification(streetFloodDepth, "ai_generated") }), memorySink());
    expect(r.decision.status).toBe("rejected");
    expect(r.decision.reasonCodes).toEqual(expect.arrayContaining(["AI_GENERATED_SUSPECTED", "CHALLENGE_FAILED"]));
    expect(stage(r, "authenticity").status).toBe("fail");
  });

  it("screen recapture → rejected", async () => {
    const r = await runPipeline(await baseInput(), deps({ verify: async () => mockVerification(streetFloodDepth, "screen_recapture") }), memorySink());
    expect(r.decision.status).toBe("rejected");
    expect(r.decision.reasonCodes).toContain("SCREEN_RECAPTURE");
  });

  it("stage exception → error → needs_review", async () => {
    const r = await runPipeline(await baseInput(), deps({ precipitationMm: async () => { throw new Error("open-meteo down"); } }), memorySink());
    expect(stage(r, "context").status).toBe("error");
    expect(r.decision.status).toBe("needs_review");
    expect(r.decision.reasonCodes).toContain("STAGE_ERROR");
  });
});

describe("context stage", () => {
  it("DEMO_MODE waives precipitation with DEMO_WAIVER and never calls Open-Meteo", async () => {
    const precipitationMm = vi.fn(async () => 0);
    const r = await runPipeline(await baseInput(), deps({ demoMode: true, precipitationMm }), memorySink());
    const c = stage(r, "context");
    expect(c.subchecks?.find((s) => s.id === "precipitation")?.status).toBe("waived");
    expect(c.reasonCodes).toContain("DEMO_WAIVER");
    expect(precipitationMm).not.toHaveBeenCalled();
  });

  it("dry weather → WEATHER_IMPLAUSIBLE warn", async () => {
    const r = await runPipeline(await baseInput(), deps({ precipitationMm: async () => 0.4 }), memorySink());
    expect(stage(r, "context").status).toBe("warn");
    expect(stage(r, "context").reasonCodes).toContain("WEATHER_IMPLAUSIBLE");
  });

  it("outside area / outside window → hard fail", async () => {
    const r1 = await runPipeline(await baseInput({ lat: DEMO.lat + 0.1 }), deps(), memorySink());
    expect(r1.decision.status).toBe("rejected");
    expect(r1.decision.reasonCodes).toContain("OUTSIDE_AREA");
    const r2 = await runPipeline(await baseInput({ captured_at: "2026-09-01T16:00:00Z" }), deps(), memorySink());
    expect(r2.decision.status).toBe("rejected");
    expect(r2.decision.reasonCodes).toContain("OUTSIDE_WINDOW");
  });

  it("daylight mismatch: model says day, sun is down", async () => {
    const night = "2026-09-26T07:00:00.000Z"; // 03:00 in Atlanta
    expect(expectedLighting(DEMO.lat, DEMO.lng, new Date(night))).toBe("night");
    const r = await runPipeline(await baseInput({ captured_at: night, received_at: night }), deps(), memorySink());
    expect(stage(r, "context").reasonCodes).toContain("DAYLIGHT_MISMATCH");
  });

  it("NWS failure only skips the alerts subcheck", async () => {
    const r = await runPipeline(await baseInput(), deps({ alertsAt: async () => { throw new Error("nws down"); } }), memorySink());
    expect(stage(r, "context").status).toBe("pass");
    expect(stage(r, "context").subchecks?.find((s) => s.id === "alerts")?.status).toBe("skipped");
  });
});

describe("duplicates stage", () => {
  it("velocity > 6/user/cell/hour → VELOCITY_LIMIT (review cap)", async () => {
    const r = await runPipeline(await baseInput(), deps({ countUserCellSince: async () => 6 }), memorySink());
    expect(stage(r, "duplicates").reasonCodes).toContain("VELOCITY_LIMIT");
    expect(r.decision.status).toBe("needs_review");
  });

  it("impossible travel > 150 km/h → IMPOSSIBLE_TRAVEL", async () => {
    const prev = { lat: DEMO.lat + 1, lng: DEMO.lng, captured_at: "2026-09-26T15:30:00.000Z" }; // ~111 km in 30 min
    const r = await runPipeline(await baseInput(), deps({ previousUserSubmission: async () => prev }), memorySink());
    expect(stage(r, "duplicates").reasonCodes).toContain("IMPOSSIBLE_TRAVEL");
    expect(r.decision.status).toBe("needs_review");
  });

  it("GPS jitter is not travel", async () => {
    const prev = { lat: DEMO.lat + 0.001, lng: DEMO.lng, captured_at: "2026-09-26T15:59:59.000Z" };
    const r = await runPipeline(await baseInput(), deps({ previousUserSubmission: async () => prev }), memorySink());
    expect(stage(r, "duplicates").reasonCodes).not.toContain("IMPOSSIBLE_TRAVEL");
  });

  it("near-identical prior hash → DUPLICATE", async () => {
    const input = await baseInput();
    const h = await dHash(input.frames[1]!.bytes!);
    const r = await runPipeline(input, deps({ priorHashes: async () => [{ id: "00000000-0000-4000-8000-0000000000aa", phashes: [h] }] }), memorySink());
    expect(r.decision.status).toBe("rejected");
    expect(r.decision.reasonCodes).toContain("DUPLICATE");
  });
});

describe("corroboration stage", () => {
  const near = (depth: number) => [{ id: "n1", lat: DEMO.lat + 0.001, lng: DEMO.lng, extracted: { depth_cm: depth } }];
  it("agreeing neighbour within ±10 cm boosts", async () => {
    const r = await runPipeline(await baseInput(), deps({ acceptedNear: async () => near(18) }), memorySink());
    expect(stage(r, "corroboration").score).toBeGreaterThan(0.8);
  });
  it("disagreeing neighbour lowers the score", async () => {
    const r = await runPipeline(await baseInput(), deps({ acceptedNear: async () => near(60) }), memorySink());
    expect(stage(r, "corroboration").status).toBe("warn");
    expect(stage(r, "corroboration").score).toBeLessThan(0.5);
  });
  it("neighbours beyond 300 m are ignored", async () => {
    const far = [{ id: "n1", lat: DEMO.lat + 0.01, lng: DEMO.lng, extracted: { depth_cm: 12 } }];
    const r = await runPipeline(await baseInput(), deps({ acceptedNear: async () => far }), memorySink());
    expect(stage(r, "corroboration").score).toBe(0.5);
  });
});

describe("synthetic guard", () => {
  it("assertObservationPaths refuses the synthetic bucket and traversal", () => {
    expect(() => assertObservationPaths(["observations/u/s/0.jpg"])).not.toThrow();
    expect(() => assertObservationPaths(["synthetic/redteam/x.jpg"])).toThrow(SyntheticMediaError);
    expect(() => assertObservationPaths(["observations/../synthetic/x.jpg"])).toThrow(SyntheticMediaError);
  });

  it("the live pipeline rejects synthetic-bucket media and never shows it to the model", async () => {
    const verify = vi.fn(async (): Promise<VerificationOutput> => mockVerification(streetFloodDepth));
    const input = await baseInput({ source: "live", frames: [{ path: "synthetic/redteam/fake.jpg", bytes: await randomJpeg(320, 240) }] });
    const r = await runPipeline(input, deps({ verify }), memorySink());
    expect(r.decision.status).toBe("rejected");
    expect(r.decision.reasonCodes).toContain("SYNTHETIC_MEDIA");
    expect(verify).not.toHaveBeenCalled();
    expect(r.checks.slice(1).every((c) => c.status === "skipped")).toBe(true);
  });

  it("redteam source skips session integrity (and the path guard) but still verifies", async () => {
    const verify = vi.fn(async () => mockVerification(streetFloodDepth));
    const input = await baseInput({ source: "redteam", frames: [{ path: "synthetic/redteam/fake.jpg", bytes: await randomJpeg(320, 240) }] });
    const r = await runPipeline(input, deps({ verify }), memorySink());
    expect(stage(r, "session_integrity").status).toBe("skipped");
    expect(verify).toHaveBeenCalledTimes(1);
  });
});

describe("helpers", () => {
  it("dHash: same image 0, different images far apart", async () => {
    const a = await randomJpeg(320, 240, 0.1);
    const b = await randomJpeg(320, 240, 0.9);
    expect(hamming(await dHash(a), await dHash(a))).toBe(0);
    expect(hamming(await dHash(a), await dHash(b))).toBeGreaterThan(6);
  });

  it("Open-Meteo sum covers only the lookback window", () => {
    const at = new Date("2026-09-26T12:00:00Z");
    const h = (iso: string) => Date.parse(iso) / 1000;
    const body = { hourly: { time: [h("2026-09-24T10:00:00Z"), h("2026-09-26T09:00:00Z"), h("2026-09-26T12:00:00Z")], precipitation: [50, 3, 2.5] } };
    expect(sumPrecipitation(body, at, 48)).toBe(5.5);
  });

  it("NWS parsing + point-in-polygon", () => {
    const alerts = parseNwsAlerts({
      features: [
        {
          geometry: { type: "Polygon", coordinates: [[[-85, 33], [-84, 33], [-84, 34], [-85, 34], [-85, 33]]] },
          properties: { id: "a1", event: "Flash Flood Emergency", severity: "Extreme", headline: "h" },
        },
        { properties: { event: "no id" } },
      ],
    });
    expect(alerts).toHaveLength(1);
    expect(pointInAlert(33.5, -84.5, alerts[0]!.geometry!)).toBe(true);
    expect(pointInAlert(35, -84.5, alerts[0]!.geometry!)).toBe(false);
  });
});
