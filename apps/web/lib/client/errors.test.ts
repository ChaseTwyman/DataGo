import { CreateBountyRequestSchema, LenientSubmissionListResponseSchema, stageLabel } from "@groundtruth/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { orderedChecks, reasonTone } from "./checkFormat";
import { ApiClientError, errorMessage, fieldErrors, fieldErrorSummary, FriendlyError } from "./errors";

/** Anything that looks like internals: HTTP status text, JSON, paths, zod dumps, exception strings. */
const RAW = /\{|\}|\/api\/|✖|→|Unexpected response|Non-JSON|HTTP|\b[45]\d\d\b|Bad Gateway|Internal Server|TypeError|undefined/;

describe("dashboard errorMessage", () => {
  const table: [string, unknown, RegExp][] = [
    ["network", new ApiClientError("Network error: Failed to fetch", 0, "network"), /Can't reach/],
    ["contract mismatch", new ApiClientError("Unexpected response from /api/bounties: ✖ Invalid input", 200, "contract_mismatch", []), /returned something unexpected — refresh|Refresh the page/],
    ["401", new ApiClientError("Missing or invalid bearer token", 401, "UNAUTHORIZED"), /session expired/],
    ["403", new ApiClientError("Not your bounty", 403, "FORBIDDEN"), /doesn't have access/],
    ["404", new ApiClientError("Bounty not found", 404, "NOT_FOUND"), /couldn't find/],
    ["409 review race", new ApiClientError("Submission is accepted, not needs_review", 409, "NOT_IN_REVIEW"), /already reviewed/],
    ["409 unknown", new ApiClientError("x", 409, "NEW_CONFLICT"), /changed in the meantime/],
    ["400 validation", new ApiClientError("Request failed validation", 400, "VALIDATION_FAILED", []), /fields need attention/],
    ["429", new ApiClientError("429 Too Many Requests", 429, "http_error"), /Wait a few seconds/],
    ["502 grok", new ApiClientError("The AI service is unavailable", 502, "GROK_UNAVAILABLE"), /AI service is busy/],
    ["502 html", new ApiClientError("502 Bad Gateway", 502, "http_error"), /on our side/],
    ["500", new ApiClientError("Something went wrong on our side.", 500, "INTERNAL"), /on our side/],
    ["zod", new z.ZodError([]), /fields need attention/],
    ["fetch TypeError", new TypeError("Failed to fetch"), /Can't reach/],
    ["random", new Error("Cannot read properties of undefined"), /Something went wrong/],
    ["string", "boom", /Something went wrong/],
  ];
  for (const [name, err, want] of table) {
    it(`maps ${name}`, () => {
      const m = errorMessage(err);
      expect(m).toMatch(want);
      expect(m).not.toMatch(RAW);
    });
  }

  it("shows FriendlyError copy verbatim", () => {
    expect(errorMessage(new FriendlyError("That email and password don't match. Try again."))).toBe("That email and password don't match. Try again.");
  });
});

describe("fieldErrors", () => {
  it("turns client-side zod issues into per-field sentences", () => {
    const r = CreateBountyRequestSchema.safeParse({
      protocol_id: "00000000-0000-4000-8000-000000000001",
      title: "ab",
      center_lat: 95,
      center_lng: 0,
      radius_m: 100,
      starts_at: "2026-01-02T00:00:00Z",
      ends_at: "2026-01-01T00:00:00Z",
      target_per_cell: 0,
    });
    expect(r.success).toBe(false);
    const fe = fieldErrors(r.error);
    expect(fe.title).toBe("Must be at least 3 characters.");
    expect(fe.center_lat).toBe("Must be at most 90.");
    expect(fe.target_per_cell).toBeTruthy();
    for (const v of Object.values(fe)) expect(v).not.toMatch(RAW);
    expect(fieldErrorSummary({ center_lat: fe.center_lat! })).toBe("Latitude: Must be at most 90.");
  });

  it("maps cross-field refinements to the field they concern", () => {
    const r = CreateBountyRequestSchema.safeParse({
      protocol_id: "00000000-0000-4000-8000-000000000001", title: "abc", center_lat: 1, center_lng: 1, radius_m: 100,
      starts_at: "2026-01-02T00:00:00Z", ends_at: "2026-01-01T00:00:00Z", target_per_cell: 5,
    });
    const fe = fieldErrors(r.error);
    expect(fe.ends_at).toBe("End must be after the start.");
  });

  it("reads server 400 VALIDATION_FAILED details and ignores other errors", () => {
    const issues = [{ code: "too_small", minimum: 100, origin: "number", path: ["base_price_cents"], message: "Too small: expected number to be >=100" }];
    expect(fieldErrors(new ApiClientError("Request failed validation", 400, "VALIDATION_FAILED", issues))).toEqual({ base_price_cents: "Must be at least $1.00." });
    expect(fieldErrors(new ApiClientError("x", 500, "INTERNAL", issues))).toEqual({});
    expect(fieldErrors(new Error("x"))).toEqual({});
  });
});

describe("forward-compatible dashboard rendering", () => {
  it("keeps unknown stages (after the known ones) with their payload label and neutral reason tone", () => {
    const parsed = LenientSubmissionListResponseSchema.parse({
      submissions: [
        {
          id: "00000000-0000-4000-8000-000000000001", session_id: null, bounty_id: "00000000-0000-4000-8000-000000000002",
          user_id: "00000000-0000-4000-8000-000000000003", media: [], lat: 1, lng: 2, accuracy_m: null, h3_cell: "c",
          captured_at: "2026-09-26T12:00:00Z", received_at: "2026-09-26T12:00:00Z", status: "quarantined",
          checks: [{ stage: "scene_physics", label: "Scene physics", status: "inconclusive", score: null, reasonCodes: ["PHYSICS_ODD"], evidence: [], ms: 3 }],
          reason_codes: ["PHYSICS_ODD"], confidence: null, protocol_score: null, authenticity_score: null, extracted: null,
          field_notes: null, payout_cents: null, media_urls: [], retryable: false, bounty_title: "b",
        },
      ],
    });
    const s = parsed.submissions[0]!;
    expect(s.status).toBe("quarantined");
    const rows = orderedChecks(s.checks);
    const last = rows.at(-1)!;
    expect(last.stage).toBe("scene_physics");
    expect(stageLabel(last.stage, last.label)).toBe("Scene physics");
    expect(rows.slice(0, -1).every((r) => r.status === "pending")).toBe(true);
    expect(reasonTone("PHYSICS_ODD")).toBe("info");
  });
});
