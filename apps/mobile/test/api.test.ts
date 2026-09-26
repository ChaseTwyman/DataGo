import { DEMO, pendingChecks, streetFloodDepth, type HealthResponse, type SubmissionRow } from "@groundtruth/shared";
import { describe, expect, it } from "vitest";
import { bootstrapAuth, type AuthDeps } from "../src/api/authFlow";
import { endpoints } from "../src/api/endpoints";
import { ApiError, buildUrl, Http, type FetchLike } from "../src/api/http";
import { resultView, watchSubmission } from "../src/api/submissionWatch";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const key = `${init.method} ${url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]}`;
    const r = routes[key];
    if (!r) return { ok: false, status: 404, text: async () => JSON.stringify({ error: { code: "NOT_FOUND", message: key } }) };
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(r.body) };
  };
  return { f, calls };
}

const health = (over: Partial<HealthResponse> = {}): HealthResponse => ({ ok: true, backend: "local", mock_grok: true, demo_mode: true, realtime: false, ...over });
const UID = "00000000-0000-4000-8000-00000000abcd";

describe("Http", () => {
  it("builds query strings and strips trailing slashes", () => {
    expect(buildUrl("http://x:3000/", "/api/bounties/nearby", { lat: 1.5, lng: -2, radius_km: undefined })).toBe(
      "http://x:3000/api/bounties/nearby?lat=1.5&lng=-2",
    );
  });

  it("sends the bearer token and the mock-variant header only where enabled", async () => {
    const { f, calls } = fakeFetch({
      "POST /api/capture/frame-check": {
        body: {
          result: { elements: [], framing_ok: true, blur_ok: true, lighting_ok: true, suspected_screen_or_print: { value: true, confidence: 0.9 }, hint: "x" },
          all_green: false,
          checks_used: 1,
          checks_remaining: 89,
          ms: 700,
        },
      },
      "GET /api/me/wallet": { body: { balance_cents: 0, trust_score: 0.5, entries: [] } },
    });
    const api = endpoints(new Http({ baseUrl: "http://lan:3000", fetch: f, getToken: () => "dev.tok", getMockVariant: () => "screen_recapture" }));
    await api.frameCheck({ session_id: UID, image_base64: "A".repeat(200) });
    await api.wallet();
    expect(calls[0]?.headers.Authorization).toBe("Bearer dev.tok");
    expect(calls[0]?.headers["x-mock-variant"]).toBe("screen_recapture");
    expect(calls[1]?.headers["x-mock-variant"]).toBeUndefined();
  });

  it("maps API error bodies and contract mismatches to ApiError", async () => {
    const { f } = fakeFetch({
      "GET /api/me/wallet": { status: 401, body: { error: { code: "UNAUTHORIZED", message: "no token" } } },
      "GET /api/health": { body: { ok: true } },
    });
    const api = endpoints(new Http({ baseUrl: "http://lan:3000", fetch: f, getToken: () => null }));
    await expect(api.wallet()).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    await expect(api.health()).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });

  it("network failures become NETWORK errors", async () => {
    const http = new Http({ baseUrl: "http://lan", fetch: async () => { throw new TypeError("Network request failed"); }, getToken: () => null });
    await expect(endpoints(http).health()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("bootstrapAuth", () => {
  function deps(over: Partial<AuthDeps> = {}) {
    const saved: string[] = [];
    const devCalls: (string | undefined)[] = [];
    const d: AuthDeps = {
      health: async () => health(),
      supabaseConfigured: false,
      supabaseSignIn: async () => ({ userId: "sb-user", token: "sb" }),
      devSession: async (id) => {
        devCalls.push(id);
        return { user_id: id ?? UID, access_token: "dev.x" };
      },
      loadDevUserId: async () => null,
      saveDevUserId: async (id) => {
        saved.push(id);
      },
      ...over,
    };
    return { d, saved, devCalls };
  }

  it("uses anonymous Supabase auth when the backend is supabase and it is configured", async () => {
    const { d, devCalls } = deps({ health: async () => health({ backend: "supabase", realtime: true }), supabaseConfigured: true });
    expect(await bootstrapAuth(d)).toMatchObject({ mode: "supabase", userId: "sb-user", devToken: null });
    expect(devCalls).toEqual([]);
  });

  it("falls back to a dev session and persists the user id", async () => {
    const { d, saved } = deps();
    expect(await bootstrapAuth(d)).toMatchObject({ mode: "dev", userId: UID, devToken: "dev.x" });
    expect(saved).toEqual([UID]);
  });

  it("reuses the persisted dev user", async () => {
    const { d, devCalls, saved } = deps({ loadDevUserId: async () => UID });
    await bootstrapAuth(d);
    expect(devCalls).toEqual([UID]);
    expect(saved).toEqual([]);
  });

  it("supabase backend without phone config still uses dev session", async () => {
    const { d } = deps({ health: async () => health({ backend: "supabase" }) });
    expect((await bootstrapAuth(d)).mode).toBe("dev");
  });
});

describe("watchSubmission", () => {
  const row = (status: string) => ({ status });

  it("polls every second until a final status", async () => {
    const seq = ["pending", "verifying", "accepted"];
    const seen: string[] = [];
    const timers: (() => void)[] = [];
    watchSubmission({
      fetchOnce: async () => row(seq.shift() ?? "accepted"),
      subscribe: null,
      onUpdate: (r) => seen.push(r.status),
      setTimeout: (fn, ms) => {
        expect(ms).toBe(1000);
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    while (timers.length) {
      timers.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(seen).toEqual(["pending", "verifying", "accepted"]);
  });

  it("with realtime: one initial GET, then pushes; unsubscribes on final", async () => {
    let push!: (r: { status: string }) => void;
    let unsubscribed = false;
    let fetches = 0;
    const seen: string[] = [];
    watchSubmission({
      fetchOnce: async () => {
        fetches++;
        return row("verifying");
      },
      subscribe: (cb) => {
        push = cb;
        return () => (unsubscribed = true);
      },
      onUpdate: (r) => seen.push(r.status),
    });
    await new Promise((r) => setTimeout(r, 0));
    push(row("needs_review"));
    expect(seen).toEqual(["verifying", "needs_review"]);
    expect(fetches).toBe(1);
    expect(unsubscribed).toBe(true);
  });
});

describe("resultView (PRD §7.5)", () => {
  const base = (status: SubmissionRow["status"], codes: string[]) =>
    ({ status, reason_codes: codes, payout_cents: status === "accepted" ? 1000 : null }) as Pick<SubmissionRow, "status" | "reason_codes" | "payout_cents">;

  it("integrity rejects only ever show the neutral message", () => {
    for (const codes of [["SCREEN_RECAPTURE"], ["DUPLICATE", "BLURRY"], ["CHALLENGE_FAILED", "MISSING_ELEMENT:waterline"]]) {
      const v = resultView(base("rejected", codes), streetFloodDepth, { sessionOpen: true });
      expect(v).toEqual({ kind: "integrity_reject", title: "Not verified", messages: ["We couldn't verify this capture."], retryable: false });
    }
  });

  it("protocol rejects give specific fixes and one-tap retry while the session is open", () => {
    const v = resultView(base("rejected", ["MISSING_ELEMENT:waterline", "BLURRY"]), streetFloodDepth, { sessionOpen: true });
    expect(v.kind).toBe("protocol_reject");
    expect(v.messages).toEqual(["Missing from the shot: Waterline visible.", "The photo was blurry. Hold the phone steady and try again."]);
    expect(v.retryable).toBe(true);
    expect(resultView(base("rejected", ["BLURRY"]), streetFloodDepth, { sessionOpen: false }).retryable).toBe(false);
  });

  it("accepted shows the demo waiver when present; needs_review uses the PRD copy", () => {
    expect(resultView(base("accepted", ["DEMO_WAIVER"]), streetFloodDepth).messages).toContain("Weather check waived (demo).");
    expect(resultView(base("needs_review", ["LOW_TRUST_REVIEW"]), streetFloodDepth).messages).toEqual([
      "Looks good. A reviewer will confirm within 24 hours.",
    ]);
    expect(resultView(base("verifying", []), streetFloodDepth).kind).toBe("verifying");
  });

  it("shared fixtures still line up (pending checks list has 7 stages)", () => {
    expect(pendingChecks()).toHaveLength(7);
    expect(DEMO.bountyId).toMatch(/^0000/);
  });
});
