import { describe, expect, it } from "vitest";
import {
  contributorMessage,
  isKnownReasonCode,
  LenientBountyDetailSchema,
  LenientChecksSchema,
  LenientCreateSessionResponseSchema,
  LenientHealthResponseSchema,
  LenientSubmissionListResponseSchema,
  LenientSubmissionWithMediaSchema,
  LenientWalletResponseSchema,
  NEUTRAL_INTEGRITY_MESSAGE,
  reasonKind,
  stageLabel,
  streetFloodDepth,
  SubmissionWithMediaSchema,
} from "../src";

const UID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-09-26T12:00:00.000Z";

/** A submission as a NEWER server might send it: a stage, reason code, status and fields this build has never seen. */
function futureSubmission() {
  return {
    id: UID,
    session_id: UID,
    bounty_id: UID,
    user_id: UID,
    media: [{ path: "observations/u/s/0.jpg", captured_at: NOW }],
    lat: 33.7,
    lng: -84.4,
    accuracy_m: 5,
    h3_cell: "892a100d2c3ffff",
    captured_at: NOW,
    received_at: NOW,
    status: "rejected",
    checks: [
      { stage: "session_integrity", label: "Session integrity", status: "pass", score: 1, reasonCodes: [], evidence: [], ms: 3 },
      { stage: "relevance", label: "Subject relevance", status: "fail", score: 0.1, reasonCodes: ["OFF_TOPIC"], evidence: ["a bottle"], ms: 2100 },
      // Unknown stage id + unknown stage status + unknown reason code + an extra field.
      { stage: "future_stage", label: "Future scene physics", status: "inconclusive", score: null, reasonCodes: ["FUTURE_CODE"], evidence: [], ms: 5, extra_field: { a: 1 } },
    ],
    reason_codes: ["OFF_TOPIC", "FUTURE_CODE"],
    confidence: 0.9,
    protocol_score: 0.1,
    authenticity_score: 0.9,
    extracted: null,
    field_notes: {},
    payout_cents: null,
    media_urls: [],
    retryable: true,
    bounty_title: "Flood watch",
    verifier: "ensemble_v2",
    some_new_top_level_field: [1, 2, 3],
  };
}

describe("forward-compatible client parsing", () => {
  it("strict contract rejects a newer payload (the bug old phone builds hit)", () => {
    expect(SubmissionWithMediaSchema.safeParse(futureSubmission()).success).toBe(false);
  });

  it("lenient submission accepts unknown stage ids, statuses, reason codes, verifier and extra fields", () => {
    const r = LenientSubmissionWithMediaSchema.parse(futureSubmission());
    expect(r.status).toBe("rejected");
    expect(r.reason_codes).toEqual(["OFF_TOPIC", "FUTURE_CODE"]);
    expect(r.verifier).toBe("ensemble_v2");
    expect(r.checks.map((c) => c.stage)).toEqual(["session_integrity", "relevance", "future_stage"]);
    const future = r.checks[2]!;
    expect(future.status).toBe("inconclusive");
    expect(future.reasonCodes).toEqual(["FUTURE_CODE"]);
    expect("extra_field" in future).toBe(false);
    expect("some_new_top_level_field" in r).toBe(false);
  });

  it("renders unknown values with neutral labels", () => {
    const r = LenientSubmissionWithMediaSchema.parse(futureSubmission());
    const future = r.checks[2]!;
    expect(stageLabel(future.stage, future.label)).toBe("Future scene physics");
    expect(stageLabel("another_new_stage")).toBe("Another new stage");
    expect(stageLabel("relevance", "ignored")).toBe("Subject relevance");
    expect(isKnownReasonCode("FUTURE_CODE")).toBe(false);
    expect(reasonKind("FUTURE_CODE")).toBe("review");
    expect(contributorMessage("FUTURE_CODE")).toBe(NEUTRAL_INTEGRITY_MESSAGE);
    // Known codes keep their specific copy.
    expect(contributorMessage("BLURRY")).toMatch(/blurry/i);
  });

  it("drops only the list items that cannot be parsed", () => {
    const good = futureSubmission();
    const r = LenientSubmissionListResponseSchema.parse({ submissions: [good, { id: "not-a-uuid" }, 42] });
    expect(r.submissions).toHaveLength(1);
    expect(LenientChecksSchema.parse([{ nonsense: true }, futureSubmission().checks[0]])).toHaveLength(1);
    expect(LenientChecksSchema.parse(null)).toEqual([]);
  });

  it("lenient protocol degrades unknown enum values to safe known ones and stays a valid Protocol", () => {
    type Loose = {
      safety: { level: string };
      capture: { mode: string; orientation: string; field_questions: unknown[] };
      acceptance: { extraction_rules?: unknown[] };
      [k: string]: unknown;
    };
    const def = JSON.parse(JSON.stringify(streetFloodDepth)) as Loose;
    def.safety.level = "extreme";
    def.capture.mode = "video";
    def.capture.orientation = "square";
    def.capture.field_questions.push({ id: "photo_note", question: "Anything else?", type: "voice_memo" });
    def.acceptance.extraction_rules = [{ kind: "future_rule", field: "x" }, { kind: "required_number", field: "depth_cm" }];
    def.brand_new_section = { x: 1 };
    const bounty = {
      id: UID, title: "t", summary: "", status: "archived", source: "satellite", protocol_id: UID, protocol: def,
      area: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      center_lat: 0, center_lng: 0, radius_m: 100, cells: [], starts_at: NOW, ends_at: NOW, event_started_at: null,
      base_price_cents: 100, max_price_cents: 200, target_per_cell: 3, priority: 1, budget_cents: 1000, spent_cents: 0,
      example_image_url: null, briefing_video_url: null, sponsor_name: null, sponsor_url: null, coverage: [{ bogus: true }],
    };
    const b = LenientBountyDetailSchema.parse(bounty);
    expect(b.status).toBe("archived");
    expect(b.protocol.safety.level).toBe("elevated");
    expect(b.protocol.capture.mode).toBe("burst");
    expect(b.protocol.capture.orientation).toBe("any");
    expect(b.protocol.capture.field_questions.at(-1)).toEqual({ id: "photo_note", question: "Anything else?", type: "text" });
    expect(b.protocol.acceptance.extraction_rules).toEqual([{ kind: "required_number", field: "depth_cm" }]);
    expect(b.coverage).toEqual([]);

    const session = LenientCreateSessionResponseSchema.safeParse({
      session_id: UID, nonce: "n".repeat(16), challenge: { id: "c", instruction: "i", expect: "e" }, price_quote_cents: 100,
      quote_expires_at: NOW, expires_at: NOW, cell: "892a100d2c3ffff", uploads: [], protocol: def, frame_check_limit: 90,
    });
    expect(session.success).toBe(true);
  });

  it("wallet and health tolerate new kinds / backends", () => {
    const w = LenientWalletResponseSchema.parse({
      balance_cents: 10, trust_score: 0.5,
      entries: [{ id: UID, submission_id: null, amount_cents: 10, kind: "referral", created_at: NOW, bounty_title: null }],
    });
    expect(w.entries[0]?.kind).toBe("referral");
    const h = LenientHealthResponseSchema.parse({ ok: true, backend: "edge", mock_grok: false, demo_mode: false, realtime: "yes" });
    expect(h.backend).toBe("edge");
    expect(h.realtime).toBe(false);
  });
});

describe("sponsor-pool additions (000007) stay forward/backward compatible", async () => {
  const { LenientBountyDetailSchema: Detail, LenientNearbyResponseSchema: Nearby, streetFloodDepth: proto } = await import("../src");
  const base = {
    id: UID, title: "t", summary: "", status: "pending_funding", source: "manual", protocol_id: UID, protocol: proto,
    area: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    center_lat: 0, center_lng: 0, radius_m: 100, cells: [], starts_at: NOW, ends_at: NOW, event_started_at: null,
    base_price_cents: 200, max_price_cents: 1000, target_per_cell: 3, priority: 1, budget_cents: 0, spent_cents: 0,
    example_image_url: null, briefing_video_url: null, sponsor_name: null, sponsor_url: null,
    coverage: [{ cell: "c", accepted: 0, target: 3, price_cents: 600, surge: 3, paused: false, paused_reason: null, price_reasons: ["Few readings here"] }],
  };
  it("old payloads (no price_reasons / funding) and new ones both parse; a malformed funding block hides the panel", () => {
    const old = Detail.parse({ ...base, coverage: [{ ...base.coverage[0], price_reasons: undefined }] });
    expect(old.funding).toBeUndefined();
    const withFunding = Detail.parse({ ...base, justification: "why", funding: { allocation_cents: "lots" } });
    expect(withFunding.funding).toBeNull();
    expect(withFunding.coverage[0]?.price_reasons).toEqual(["Few readings here"]);
    expect(withFunding.status).toBe("pending_funding");
  });
  it("nearby bounties carry optional price_reasons", () => {
    const summary = {
      id: UID, title: "t", summary: "", protocol_slug: "p", protocol_name: "P", safety_level: "elevated", center_lat: 0, center_lng: 0,
      radius_m: 100, distance_m: 5, price_cents: 600, surge: 3, max_surge: 3, ends_at: NOW, cells_total: 1, cells_needed: 1, paused_cells: 0,
      match_score: 0.5, match_reason: null, budget_remaining_cents: 100, example_image_url: null,
    };
    const n = Nearby.parse({ bounties: [summary, { ...summary, price_reasons: ["Event is recent"] }] });
    expect(n.bounties[0]?.price_reasons).toBeUndefined();
    expect(n.bounties[1]?.price_reasons).toEqual(["Event is recent"]);
  });
});
