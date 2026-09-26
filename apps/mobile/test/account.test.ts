import { describe, expect, it } from "vitest";
import {
  classifyAuthError,
  dashboardUrl,
  deleteConfirmed,
  gateView,
  mapSupabaseAuthError,
  NO_REAUTH_CODES,
  sessionActionFor,
  validateSignup,
  type GateInput,
  type SignupForm,
} from "../src/api/authFlow";
import { endpoints } from "../src/api/endpoints";
import { toUserMessage } from "../src/api/errors";
import { ApiError, Http, type FetchLike } from "../src/api/http";

const RAW = /\{|\}|\[object|at \w+ \(|stack|HTTP_|\b[45]\d\d\b|zod|undefined|null|Error:|contract|CONTRACT|api\/|_[A-Z]/;
const UID = "00000000-0000-4000-8000-00000000abcd";
const ME = {
  id: UID,
  email: "sam@example.com",
  display_name: "Sam",
  is_contributor: true,
  is_researcher: false,
  is_admin: false,
  suspended: false,
  researcher_profile: null,
  trust_score: 0.5,
  balance_cents: 1160,
  created_at: "2026-09-26T12:00:00.000Z",
};

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fetcher(handler: (method: string, path: string) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const r = handler(init.method, url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]!);
    return { ok: r.status < 400, status: r.status, text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)) };
  };
  return { f, calls };
}
const err = (code: string, message = "server text") => ({ error: { code, message } });

describe("root gate (who may see app screens)", () => {
  const base: GateInput = { ready: true, session: "signed_in", me: { suspended: false }, meError: false, suspendedFlag: false };
  it("no session decided yet → boot splash", () => {
    expect(gateView({ ...base, ready: false })).toBe("boot");
    expect(gateView({ ...base, session: null })).toBe("boot");
  });
  it("signed out → Welcome, even if stale account data is around", () => {
    expect(gateView({ ...base, session: "signed_out" })).toBe("welcome");
    expect(gateView({ ...base, session: "signed_out", me: { suspended: true } })).toBe("welcome");
  });
  it("signed in but /api/me not loaded → loading, never the app", () => {
    expect(gateView({ ...base, me: null })).toBe("loading_account");
    expect(gateView({ ...base, me: null, meError: true })).toBe("account_error");
  });
  it("suspended (from /api/me or a mid-use ACCOUNT_SUSPENDED) → blocking screen", () => {
    expect(gateView({ ...base, me: { suspended: true } })).toBe("suspended");
    expect(gateView({ ...base, suspendedFlag: true })).toBe("suspended");
    expect(gateView({ ...base, me: null, suspendedFlag: true })).toBe("suspended");
  });
  it("signed in with a loaded, active account → app", () => {
    expect(gateView(base)).toBe("app");
  });
});

describe("session handling of API errors", () => {
  const signedIn = { session: "signed_in", authMode: "supabase" } as const;

  it("classifies account/session failures", () => {
    expect(classifyAuthError(new ApiError(401, "ACCOUNT_REQUIRED", ""))).toBe("account_required");
    expect(classifyAuthError(new ApiError(403, "ACCOUNT_REQUIRED", ""))).toBe("account_required");
    expect(classifyAuthError(new ApiError(403, "ACCOUNT_SUSPENDED", ""))).toBe("suspended");
    expect(classifyAuthError(new ApiError(401, "UNAUTHORIZED", ""))).toBe("session_ended");
    // Wrong current password on change-password: the session is fine.
    expect(classifyAuthError(new ApiError(401, "INVALID_CREDENTIALS", ""))).toBeNull();
    expect(classifyAuthError(new ApiError(403, "FORBIDDEN", ""))).toBeNull();
    expect(classifyAuthError(new ApiError(0, "NETWORK", ""))).toBeNull();
    expect(classifyAuthError(new Error("x"))).toBeNull();
  });

  it("maps to actions only while signed in, and Welcome only for Supabase accounts", () => {
    expect(sessionActionFor(new ApiError(401, "ACCOUNT_REQUIRED", ""), signedIn)).toEqual({ type: "end", notice: "account_required" });
    expect(sessionActionFor(new ApiError(401, "UNAUTHORIZED", ""), signedIn)).toEqual({ type: "end", notice: "session_ended" });
    expect(sessionActionFor(new ApiError(403, "ACCOUNT_SUSPENDED", ""), signedIn)).toEqual({ type: "suspend" });
    expect(sessionActionFor(new ApiError(500, "SERVER", ""), signedIn)).toBeNull();
    expect(sessionActionFor(new ApiError(401, "ACCOUNT_REQUIRED", ""), { session: "signed_out", authMode: "supabase" })).toBeNull();
    expect(sessionActionFor(new ApiError(401, "UNAUTHORIZED", ""), { session: "signed_in", authMode: "dev" })).toBeNull();
    expect(sessionActionFor(new ApiError(403, "ACCOUNT_SUSPENDED", ""), { session: "signed_in", authMode: "dev" })).toEqual({ type: "suspend" });
  });

  it("401 ACCOUNT_REQUIRED mid-use → no token refresh, observer fires, gate shows Welcome (not an error screen)", async () => {
    let reauths = 0;
    const state: GateInput & { authMode: "supabase" } = { ready: true, session: "signed_in", me: { suspended: false }, meError: false, suspendedFlag: false, authMode: "supabase" };
    const { f } = fetcher(() => ({ status: 401, body: err("ACCOUNT_REQUIRED", "Create an account") }));
    const http = new Http({
      baseUrl: "http://lan",
      fetch: f,
      getToken: () => "anon.jwt",
      reauth: async () => {
        reauths++;
        return true;
      },
      noReauthCodes: NO_REAUTH_CODES,
      onAuthedError: (e) => {
        const a = sessionActionFor(e, state);
        if (a?.type === "end") state.session = "signed_out";
      },
    });
    await expect(endpoints(http).nearby(1, 2)).rejects.toMatchObject({ code: "ACCOUNT_REQUIRED" });
    expect(reauths).toBe(0);
    expect(gateView(state)).toBe("welcome");
  });

  it("an expired token is refreshed silently; only an unrefreshable one ends the session", async () => {
    let n = 0;
    const seen: string[] = [];
    const { f } = fetcher(() => (n++ === 0 ? { status: 401, body: err("UNAUTHORIZED") } : { status: 200, body: ME }));
    const ok = new Http({ baseUrl: "http://lan", fetch: f, getToken: () => "t", reauth: async () => true, onAuthedError: (e) => seen.push(e.code) });
    await expect(endpoints(ok).me()).resolves.toMatchObject({ id: UID });
    expect(seen).toEqual([]);

    const { f: f2 } = fetcher(() => ({ status: 401, body: err("UNAUTHORIZED") }));
    const dead = new Http({ baseUrl: "http://lan", fetch: f2, getToken: () => "t", reauth: async () => false, onAuthedError: (e) => seen.push(e.code) });
    await expect(endpoints(dead).me()).rejects.toMatchObject({ status: 401 });
    expect(seen).toEqual(["UNAUTHORIZED"]);
  });

  it("unauthenticated calls (sign-up) never trigger the session observer", async () => {
    const seen: string[] = [];
    const { f, calls } = fetcher(() => ({ status: 409, body: err("EMAIL_TAKEN") }));
    const http = new Http({ baseUrl: "http://lan", fetch: f, getToken: () => "t", onAuthedError: (e) => seen.push(e.code) });
    const body = { email: "a@b.co", password: "12345678", display_name: "A", is_adult: true as const, accept_terms: true as const };
    await expect(endpoints(http).signup(body)).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    expect(seen).toEqual([]);
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.url).toBe("http://lan/api/auth/signup");
  });
});

describe("account endpoints", () => {
  it("GET /api/me parses the contract (extra server fields tolerated)", async () => {
    const { f } = fetcher(() => ({ status: 200, body: { ...ME, some_new_field: 1 } }));
    await expect(endpoints(new Http({ baseUrl: "http://lan", fetch: f, getToken: () => "t" })).me()).resolves.toMatchObject({ email: "sam@example.com", balance_cents: 1160 });
  });

  it("DELETE /api/me sends exactly { confirm: 'DELETE' } and accepts a 204 with no body", async () => {
    const { f, calls } = fetcher(() => ({ status: 204 }));
    await endpoints(new Http({ baseUrl: "http://lan", fetch: f, getToken: () => "t" })).deleteAccount({ confirm: "DELETE" });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "http://lan/api/me" });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ confirm: "DELETE" });
    expect(calls[0]?.headers.Authorization).toBe("Bearer t");
  });

  it("GET /api/me/export returns whatever JSON the server sends", async () => {
    const { f } = fetcher(() => ({ status: 200, body: { profile: { id: UID }, submissions: [] } }));
    await expect(endpoints(new Http({ baseUrl: "http://lan", fetch: f, getToken: () => "t" })).exportData()).resolves.toEqual({ profile: { id: UID }, submissions: [] });
  });
});

describe("sign-up validation mirrors the shared contract", () => {
  const good: SignupForm = { display_name: "Sam", email: "  Sam@Example.COM ", password: "hunter22", is_adult: true, accept_terms: true };

  it("accepts a valid form and normalises the email like the server", () => {
    const r = validateSignup(good);
    expect(r).toEqual({ ok: true, data: { ...good, email: "sam@example.com" } });
  });

  it.each([
    ["display_name", { display_name: "   " }, /display name/],
    ["email", { email: "not-an-email" }, /valid email/],
    ["password", { password: "1234567" }, /at least 8/],
    ["password", { password: "x".repeat(73) }, /at most 72/],
    ["is_adult", { is_adult: false }, /18 or older/],
    ["accept_terms", { accept_terms: false }, /accept the terms/],
  ] as const)("rejects bad %s", (field, over, want) => {
    const r = validateSignup({ ...good, ...over });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[field]).toMatch(want);
      expect(Object.keys(r.errors)).toEqual([field]);
    }
  });

  it("reports every failing field at once", () => {
    const r = validateSignup({ display_name: "", email: "", password: "", is_adult: false, accept_terms: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["accept_terms", "display_name", "email", "is_adult", "password"]);
  });

  it("exactly 8 characters is enough", () => {
    expect(validateSignup({ ...good, password: "12345678" }).ok).toBe(true);
  });
});

describe("delete-account confirmation gate", () => {
  it.each([
    ["DELETE", true],
    [" DELETE ", true],
    ["delete", false],
    ["Delete", false],
    ["DELET", false],
    ["DELETE ME", false],
    ["", false],
  ])("%j → %s", (typed, want) => {
    expect(deleteConfirmed(typed)).toBe(want);
  });
});

describe("account error copy", () => {
  it.each([
    [new ApiError(409, "EMAIL_TAKEN", "User already registered"), /already exists/],
    [new ApiError(400, "INVALID_CREDENTIALS", "Invalid login credentials"), /don't match/],
    [new ApiError(401, "ACCOUNT_REQUIRED", "anonymous"), /Accounts are now required/],
    [new ApiError(403, "ACCOUNT_SUSPENDED", "banned"), /suspended/],
    [new ApiError(429, "RATE_LIMITED", "slow down"), /Wait/],
  ])("%s", (e, want) => {
    const m = toUserMessage(e);
    expect(m.message).toMatch(want);
    expect(m.message).not.toMatch(RAW);
    expect(m.title).not.toMatch(RAW);
    expect(m.message).not.toContain(e.message);
  });

  it("maps supabase-js auth errors onto our codes without keeping their text", () => {
    const cases: [unknown, string][] = [
      [{ name: "AuthApiError", status: 400, code: "invalid_credentials", message: "Invalid login credentials" }, "INVALID_CREDENTIALS"],
      [{ name: "AuthApiError", status: 400, code: "email_not_confirmed" }, "INVALID_CREDENTIALS"],
      [{ name: "AuthApiError", status: 400 }, "INVALID_CREDENTIALS"],
      [{ name: "AuthApiError", status: 429, code: "over_request_rate_limit" }, "RATE_LIMITED"],
      [{ name: "AuthApiError", status: 400, code: "user_banned" }, "ACCOUNT_SUSPENDED"],
      [{ name: "AuthRetryableFetchError", status: 0, message: "Network request failed" }, "NETWORK"],
      [{ name: "AuthApiError", status: 500, code: "unexpected_failure" }, "SERVER"],
      [null, "NETWORK"],
    ];
    for (const [e, code] of cases) {
      const mapped = mapSupabaseAuthError(e);
      expect(mapped.code).toBe(code);
      expect(toUserMessage(mapped).message).not.toMatch(RAW);
    }
  });
});

describe("dashboard link", () => {
  it("is the API origin", () => {
    expect(dashboardUrl("https://groundtruth-two-snowy.vercel.app")).toBe("https://groundtruth-two-snowy.vercel.app");
    expect(dashboardUrl("https://x.dev/")).toBe("https://x.dev");
    expect(dashboardUrl("http://10.0.0.2:3000/api")).toBe("http://10.0.0.2:3000");
  });
});
