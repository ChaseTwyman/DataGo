import { describe, expect, it } from "vitest";
import {
  RESEND_COOLDOWN_MS,
  RESET_INITIAL,
  resendWaitSeconds,
  resetReducer,
  sessionActionFor,
  validateResetEmail,
  validateResetForm,
  type ResetState,
} from "../src/api/authFlow";
import { endpoints } from "../src/api/endpoints";
import { toResetMessage, toUserMessage } from "../src/api/errors";
import { ApiError, Http, type FetchLike } from "../src/api/http";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fetcher(handler: (path: string) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const r = handler(url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]!);
    return { ok: r.status < 400, status: r.status, text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)) };
  };
  return { f, calls };
}
const err = (code: string, message = "server text") => ({ error: { code, message } });

describe("forgot-password flow state", () => {
  it("email → code (remembers the normalized address and send time) → done", () => {
    let s: ResetState = RESET_INITIAL;
    expect(s.step).toBe("email");
    s = resetReducer(s, { type: "sent", email: "sam@example.org", at: 1000 });
    expect(s).toEqual({ step: "code", sentTo: "sam@example.org", sentAt: 1000 });
    s = resetReducer(s, { type: "done" });
    expect(s.step).toBe("done");
  });

  it("change email goes back to the email step; done is only reachable from the code step", () => {
    const code = resetReducer(RESET_INITIAL, { type: "sent", email: "a@b.org", at: 0 });
    expect(resetReducer(code, { type: "change_email" }).step).toBe("email");
    expect(resetReducer(RESET_INITIAL, { type: "done" })).toBe(RESET_INITIAL);
  });

  it("resending a code restarts the code step with the new time", () => {
    const first = resetReducer(RESET_INITIAL, { type: "sent", email: "a@b.org", at: 0 });
    const again = resetReducer(first, { type: "sent", email: "a@b.org", at: 90_000 });
    expect(again).toEqual({ step: "code", sentTo: "a@b.org", sentAt: 90_000 });
  });

  it("resend cooldown counts down from 60 s", () => {
    const s = resetReducer(RESET_INITIAL, { type: "sent", email: "a@b.org", at: 10_000 });
    expect(resendWaitSeconds(RESET_INITIAL, 10_000)).toBe(0);
    expect(resendWaitSeconds(s, 10_000)).toBe(60);
    expect(resendWaitSeconds(s, 10_000 + 59_001)).toBe(1);
    expect(resendWaitSeconds(s, 10_000 + RESEND_COOLDOWN_MS)).toBe(0);
  });
});

describe("forgot-password validation", () => {
  it("email is normalized like the server does", () => {
    expect(validateResetEmail("  Sam@Example.ORG ")).toEqual({ ok: true, email: "sam@example.org" });
    expect(validateResetEmail("sam")).toEqual({ ok: false, errors: { email: "Enter a valid email address." } });
  });

  it("code + new password + confirmation", () => {
    expect(validateResetForm({ code: " 123 456", password: "long enough", confirm: "long enough" })).toEqual({ ok: true, code: "123456", password: "long enough" });
    expect(validateResetForm({ code: "12345", password: "long enough", confirm: "long enough" })).toEqual({
      ok: false,
      errors: { code: "Enter the 6-digit code from the email." },
    });
    expect(validateResetForm({ code: "123456", password: "short", confirm: "short" })).toEqual({ ok: false, errors: { new_password: "Use at least 8 characters." } });
    expect(validateResetForm({ code: "123456", password: "long enough", confirm: "long enough!" })).toEqual({
      ok: false,
      errors: { confirm_password: "The passwords don't match." },
    });
    expect(validateResetForm({ code: "123456", password: "y".repeat(73), confirm: "y".repeat(73) })).toMatchObject({ errors: { new_password: "Use at most 72 characters." } });
  });
});

describe("forgot-password errors", () => {
  const RAW = /\{|\}|\[object|stack|\b[45]\d\d\b|zod|undefined|Error:|server text/;

  it("RESET_CODE_INVALID → friendly, retryable copy (never the server's text)", () => {
    const m = toUserMessage(new ApiError(400, "RESET_CODE_INVALID", "server text"));
    expect(m.code).toBe("RESET_CODE_INVALID");
    expect(m.message).toMatch(/wrong or has expired/);
    expect(m.message).not.toMatch(RAW);
    expect(m.retryable).toBe(true);
  });

  it("RATE_LIMITED on reset screens says to wait a while, not a few seconds", () => {
    const e = new ApiError(429, "RATE_LIMITED", "server text");
    expect(toUserMessage(e).message).toMatch(/few seconds/);
    expect(toResetMessage(e).message).toMatch(/up to an hour/);
    expect(toResetMessage(e).message).not.toMatch(RAW);
    // Everything else maps as usual.
    expect(toResetMessage(new ApiError(0, "NETWORK", "x")).code).toBe("NETWORK");
    expect(toResetMessage(new ApiError(400, "RESET_CODE_INVALID", "x")).code).toBe("RESET_CODE_INVALID");
  });

  it("a wrong code never ends a signed-in session (no reauth, no session action)", () => {
    const e = new ApiError(400, "RESET_CODE_INVALID", "x");
    expect(sessionActionFor(e, { session: "signed_in", authMode: "supabase" })).toBeNull();
  });
});

describe("forgot-password endpoints", () => {
  it("request and confirm are unauthenticated calls with the right paths and bodies", async () => {
    const seen: string[] = [];
    const { f, calls } = fetcher((p) => (p.endsWith("/request") ? { status: 202, body: { ok: true } } : { status: 200, body: { ok: true, email: "a@b.org" } }));
    const http = new Http({ baseUrl: "http://lan", fetch: f, getToken: () => "stale.jwt", onAuthedError: (e) => seen.push(e.code) });
    const api = endpoints(http);
    await api.requestPasswordReset("a@b.org");
    await expect(api.confirmPasswordReset({ email: "a@b.org", code: "123456", new_password: "long enough" })).resolves.toMatchObject({ ok: true });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "http://lan/api/auth/password-reset/request"],
      ["POST", "http://lan/api/auth/password-reset/confirm"],
    ]);
    expect(calls.every((c) => c.headers.Authorization === undefined)).toBe(true);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ email: "a@b.org" });
    expect(JSON.parse(calls[1]!.body!)).toEqual({ email: "a@b.org", code: "123456", new_password: "long enough" });
    expect(seen).toEqual([]);
  });

  it("a wrong code surfaces as ApiError RESET_CODE_INVALID without touching the session", async () => {
    const seen: string[] = [];
    let reauths = 0;
    const { f } = fetcher(() => ({ status: 400, body: err("RESET_CODE_INVALID") }));
    const http = new Http({
      baseUrl: "http://lan",
      fetch: f,
      getToken: () => "t",
      reauth: async () => {
        reauths++;
        return true;
      },
      onAuthedError: (e) => seen.push(e.code),
    });
    await expect(endpoints(http).confirmPasswordReset({ email: "a@b.org", code: "000000", new_password: "long enough" })).rejects.toMatchObject({
      code: "RESET_CODE_INVALID",
      status: 400,
    });
    expect(reauths).toBe(0);
    expect(seen).toEqual([]);
  });
});
