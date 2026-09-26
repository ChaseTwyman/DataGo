import { describe, expect, it } from "vitest";
import { ApiClientError, errorMessage } from "./errors";
import { parseResetLink, validateResetConfirm, validateResetEmail } from "./resetPassword";

describe("forgot-password form validation", () => {
  it("email step: normalizes a valid address, flags an invalid one", () => {
    expect(validateResetEmail("  Sam@Example.org ")).toEqual({ ok: true, email: "sam@example.org" });
    expect(validateResetEmail("sam@")).toEqual({ ok: false, errors: { email: "Enter a valid email address." } });
    expect(validateResetEmail("")).toMatchObject({ ok: false });
  });

  it("code step: 6-digit code, 8+ char password, matching confirmation", () => {
    expect(validateResetConfirm({ code: "123 456", password: "long enough", confirm: "long enough" })).toEqual({ ok: true, code: "123456", password: "long enough" });
    expect(validateResetConfirm({ code: "12345", password: "long enough", confirm: "long enough" })).toEqual({
      ok: false,
      errors: { code: "Enter the 6-digit code from the email." },
    });
    expect(validateResetConfirm({ code: "123456", password: "short", confirm: "short" })).toEqual({ ok: false, errors: { new_password: "Use at least 8 characters." } });
    expect(validateResetConfirm({ code: "123456", password: "x".repeat(73), confirm: "x".repeat(73) })).toEqual({
      ok: false,
      errors: { new_password: "Use at most 72 characters." },
    });
    expect(validateResetConfirm({ code: "123456", password: "long enough", confirm: "long enougH" })).toEqual({
      ok: false,
      errors: { confirm_password: "The passwords don't match." },
    });
    // All problems at once, so the user fixes them in one pass.
    const all = validateResetConfirm({ code: "", password: "", confirm: "" });
    expect(all.ok).toBe(false);
    if (!all.ok) expect(Object.keys(all.errors).sort()).toEqual(["code", "new_password"]);
  });

  it("link step: no code needed", () => {
    expect(validateResetConfirm({ password: "long enough", confirm: "long enough" })).toEqual({ ok: true, code: null, password: "long enough" });
  });

  it("parses the reset link variants", () => {
    expect(parseResetLink("?token_hash=abc123def456&type=recovery", "")).toEqual({ kind: "token", tokenHash: "abc123def456" });
    expect(parseResetLink("?token_hash=abc123def456", "")).toEqual({ kind: "token", tokenHash: "abc123def456" });
    expect(parseResetLink("?token_hash=abc&type=signup", "")).toMatchObject({ kind: "none" });
    expect(parseResetLink("", "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")).toEqual({ kind: "used" });
    expect(parseResetLink("", "#access_token=eyJ&refresh_token=r&type=recovery")).toEqual({ kind: "used" });
    expect(parseResetLink("?email=sam%40example.org", "")).toEqual({ kind: "none", email: "sam@example.org" });
    expect(parseResetLink("", "")).toEqual({ kind: "none", email: "" });
  });

  it("maps the new error code to friendly copy", () => {
    expect(errorMessage(new ApiClientError("x", 400, "RESET_CODE_INVALID"))).toMatch(/wrong or has expired/);
    expect(errorMessage(new ApiClientError("x", 429, "RATE_LIMITED"))).toMatch(/wait a while/);
  });
});
