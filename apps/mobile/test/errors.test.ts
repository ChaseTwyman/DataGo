import { LenientSubmissionWithMediaSchema, streetFloodDepth } from "@groundtruth/shared";
import { describe, expect, it } from "vitest";
import { endpoints } from "../src/api/endpoints";
import { isTransient, toUserMessage, UserFacingError } from "../src/api/errors";
import { ApiError, Http, type FetchLike } from "../src/api/http";
import { resultView, watchSubmission } from "../src/api/submissionWatch";
import { UploadError, uploadFrames, uploadWithRetry } from "../src/capture/upload";

/** Anything that looks like a leak of internals: stack frames, JSON, HTTP jargon, zod dumps. */
const RAW = /\{|\}|\[object|at \w+ \(|stack|HTTP_|\b[45]\d\d\b|zod|undefined|null|Error:|contract|CONTRACT|api\//;

describe("toUserMessage", () => {
  const table: [string, unknown, RegExp][] = [
    ["offline", new ApiError(0, "NETWORK", "Network error: /api/bounties/nearby"), /couldn't reach GroundTruth/],
    ["timeout", new ApiError(0, "TIMEOUT", "Request timed out: /api/x"), /slow to respond/],
    ["401", new ApiError(401, "UNAUTHORIZED", "Missing or invalid bearer token"), /session expired/],
    ["403", new ApiError(403, "FORBIDDEN", "Researcher or admin role required"), /can't do that/],
    ["404", new ApiError(404, "NOT_FOUND", "Session not found"), /no longer available/],
    ["409 closed", new ApiError(409, "SESSION_CLOSED", "This capture session is no longer open"), /session has ended/],
    ["409 other", new ApiError(409, "SOMETHING_NEW", "x"), /changed in the meantime/],
    ["422 outside", new ApiError(422, "OUTSIDE_AREA", "You are outside the bounty area"), /outside the bounty area/],
    ["422 other", new ApiError(422, "NEW_RULE", "zod blah"), /wasn't accepted/],
    ["400 validation", new ApiError(400, "VALIDATION_FAILED", "Request failed validation", [{ path: ["lat"] }]), /wasn't accepted/],
    ["429", new ApiError(429, "HTTP_429", "POST /api/x failed (429)"), /Wait a few seconds/],
    ["frame limit", new ApiError(429, "FRAME_CHECK_LIMIT", "limit of 90 reached"), /start a new one/],
    ["502 grok", new ApiError(502, "GROK_UNAVAILABLE", "xAI 503: upstream connect error"), /AI service is busy/],
    ["500", new ApiError(500, "INTERNAL", "Internal error"), /on our side/],
    ["bare 503", new ApiError(503, "HTTP_503", "GET /api/x failed (503)"), /on our side/],
    ["contract mismatch", new ApiError(200, "CONTRACT_MISMATCH", "Response of /api/x does not match", [{ code: "invalid_value" }]), /can't read/],
    ["non-JSON", new ApiError(502, "BAD_JSON", "Non-JSON response from /api/x (502)"), /can't read/],
    ["upload", new UploadError(500, "<html>gateway</html>"), /photos are saved/],
    ["upload offline", new UploadError(0, "The Internet connection appears to be offline."), /photos are saved/],
    ["fetch TypeError", new TypeError("Network request failed"), /couldn't reach GroundTruth/],
    ["random Error", new Error("Cannot read properties of undefined (reading 'x')"), /Please try again/],
    ["string", "boom", /Please try again/],
    ["object", { weird: true }, /Please try again/],
    ["null", null, /Please try again/],
  ];
  for (const [name, err, want] of table) {
    it(`maps ${name}`, () => {
      const m = toUserMessage(err);
      expect(m.message).toMatch(want);
      expect(m.message).not.toMatch(RAW);
      expect(m.title).not.toMatch(RAW);
    });
  }

  it("passes UserFacingError copy through verbatim", () => {
    const m = toUserMessage(new UserFacingError("Turn on location in Settings.", "Location is off", false));
    expect(m).toEqual({ code: "USER", title: "Location is off", message: "Turn on location in Settings.", retryable: false });
  });

  it("classifies transient failures for quiet retries", () => {
    expect(isTransient(new ApiError(0, "NETWORK", ""))).toBe(true);
    expect(isTransient(new ApiError(503, "X", ""))).toBe(true);
    expect(isTransient(new ApiError(429, "X", ""))).toBe(true);
    expect(isTransient(new ApiError(404, "NOT_FOUND", ""))).toBe(false);
    expect(isTransient(new ApiError(200, "CONTRACT_MISMATCH", ""))).toBe(false);
  });
});

describe("Http silent re-auth", () => {
  it("renews the token once on 401 and retries", async () => {
    let token = "old";
    let calls = 0;
    const f: FetchLike = async (_url, init) => {
      calls++;
      const ok = init.headers.Authorization === "Bearer new";
      return ok
        ? { ok: true, status: 200, text: async () => JSON.stringify({ balance_cents: 1, trust_score: 0.5, entries: [] }) }
        : { ok: false, status: 401, text: async () => JSON.stringify({ error: { code: "UNAUTHORIZED", message: "expired" } }) };
    };
    let renewals = 0;
    const api = endpoints(
      new Http({
        baseUrl: "http://x",
        fetch: f,
        getToken: () => token,
        reauth: async () => {
          renewals++;
          token = "new";
          return true;
        },
      }),
    );
    await expect(api.wallet()).resolves.toMatchObject({ balance_cents: 1 });
    expect(renewals).toBe(1);
    expect(calls).toBe(2);
  });

  it("surfaces the 401 when renewal fails, and never retries unauthenticated calls", async () => {
    const f: FetchLike = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { code: "UNAUTHORIZED", message: "x" } }) });
    let renewals = 0;
    const http = new Http({ baseUrl: "http://x", fetch: f, getToken: () => "t", reauth: async () => (renewals++, false) });
    await expect(endpoints(http).wallet()).rejects.toMatchObject({ status: 401 });
    await expect(endpoints(http).health()).rejects.toMatchObject({ status: 401 });
    expect(renewals).toBe(1);
  });
});

describe("forward-compatible parsing on the phone", () => {
  it("GET /api/submissions/:id with a new stage + reason code parses and renders neutrally", async () => {
    const now = "2026-09-26T12:00:00.000Z";
    const id = "00000000-0000-4000-8000-000000000001";
    const body = {
      id, session_id: id, bounty_id: id, user_id: id, media: [], lat: 1, lng: 2, accuracy_m: null, h3_cell: "c",
      captured_at: now, received_at: now, status: "rejected",
      checks: [{ stage: "scene_physics", label: "Scene physics", status: "inconclusive", score: null, reasonCodes: ["PHYSICS_ODD"], evidence: [], ms: 1, extra: 1 }],
      reason_codes: ["PHYSICS_ODD"], confidence: null, protocol_score: null, authenticity_score: null, extracted: null,
      field_notes: null, payout_cents: null, media_urls: [], retryable: false, bounty_title: null, verifier: "committee", new_field: true,
    };
    const f: FetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const api = endpoints(new Http({ baseUrl: "http://x", fetch: f, getToken: () => "t" }));
    const row = await api.submission(id);
    expect(LenientSubmissionWithMediaSchema.safeParse(body).success).toBe(true);
    expect(row.checks[0]?.stage).toBe("scene_physics");
    const v = resultView(row, streetFloodDepth, { sessionOpen: true, serverRetryable: row.retryable });
    expect(v.kind).toBe("protocol_reject");
    expect(v.messages).toEqual(["We couldn't verify this capture."]);
    expect(v.retryable).toBe(false);
  });

  it("an unknown submission status keeps the screen in a neutral 'verifying' state", () => {
    expect(resultView({ status: "queued_for_gpu", reason_codes: [], payout_cents: null }, null).kind).toBe("verifying");
  });
});

describe("watchSubmission errors", () => {
  it("backs off on consecutive failures and recovers", async () => {
    const waits: number[] = [];
    const timers: (() => void)[] = [];
    let n = 0;
    const seen: string[] = [];
    let errors = 0;
    watchSubmission({
      fetchOnce: async () => {
        n++;
        if (n <= 3) throw new ApiError(0, "NETWORK", "x");
        return { status: "accepted" };
      },
      subscribe: null,
      onUpdate: (r) => seen.push(r.status),
      onError: () => void errors++,
      setTimeout: (fn, ms) => {
        waits.push(ms);
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: () => {},
    });
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
      timers.shift()?.();
    }
    expect(errors).toBe(3);
    expect(waits).toEqual([2000, 4000, 8000]);
    expect(seen).toEqual(["accepted"]);
  });

  it("stops when onError says the failure is terminal", async () => {
    const timers: (() => void)[] = [];
    watchSubmission({
      fetchOnce: async () => {
        throw new ApiError(404, "NOT_FOUND", "x");
      },
      subscribe: null,
      onUpdate: () => {},
      onError: () => "stop",
      setTimeout: (fn) => (timers.push(fn), 1),
      clearTimeout: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(timers).toHaveLength(0);
  });
});

describe("frame uploads", () => {
  const noSleep = { sleep: async () => {} };

  it("retries transient failures with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    let tries = 0;
    await uploadWithRetry(
      async () => {
        tries++;
        if (tries < 3) throw new UploadError(503, "busy");
      },
      { sleep: async (ms) => void sleeps.push(ms), baseMs: 100 },
    );
    expect(tries).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("does not retry a permanent failure", async () => {
    let tries = 0;
    await expect(
      uploadWithRetry(async () => {
        tries++;
        throw new UploadError(403, "signature expired");
      }, noSleep),
    ).rejects.toBeInstanceOf(UploadError);
    expect(tries).toBe(1);
  });

  it("treats 'already exists' on a retry as uploaded (first response was lost)", async () => {
    let tries = 0;
    await uploadWithRetry(async () => {
      tries++;
      if (tries === 1) throw new UploadError(0, "connection reset");
      throw new UploadError(400, '{"statusCode":"409","error":"Duplicate"}');
    }, noSleep);
    expect(tries).toBe(2);
  });

  it("keeps successful frames across submit attempts: a second attempt re-sends only the failed one", async () => {
    const done = new Set<number>();
    const sent: number[] = [];
    let failFrame2 = true;
    const upload = async (f: number) => {
      sent.push(f);
      if (f === 2 && failFrame2) throw new UploadError(403, "nope");
    };
    await expect(uploadFrames([0, 1, 2], ["a", "b", "c"], done, upload, noSleep)).rejects.toBeInstanceOf(UploadError);
    expect([...done].sort()).toEqual([0, 1]);
    failFrame2 = false;
    sent.length = 0;
    await uploadFrames([0, 1, 2], ["a", "b", "c"], done, upload, noSleep);
    expect(sent).toEqual([2]);
    expect(done.size).toBe(3);
  });
});
