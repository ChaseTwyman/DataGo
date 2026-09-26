import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ERROR_CODES,
  PasswordResetConfirmRequestSchema,
  PasswordResetConfirmResponseSchema,
  PasswordResetRequestSchema,
  ResetCodeSchema,
} from "../src";

describe("password reset contracts", () => {
  it("normalizes the email like sign-up does", () => {
    expect(PasswordResetRequestSchema.parse({ email: "  Sam@Example.COM " })).toEqual({ email: "sam@example.com" });
    expect(PasswordResetRequestSchema.safeParse({ email: "nope" }).success).toBe(false);
  });

  it("accepts a 6-10 digit code, ignoring spaces the user typed or pasted", () => {
    expect(ResetCodeSchema.parse("123456")).toBe("123456");
    expect(ResetCodeSchema.parse(" 123 456 ")).toBe("123456");
    expect(ResetCodeSchema.parse("1234567890")).toBe("1234567890");
    for (const bad of ["12345", "12345a", "", "12345678901"]) expect(ResetCodeSchema.safeParse(bad).success).toBe(false);
  });

  it("confirm takes either email+code or a link token_hash, always with an 8+ char password", () => {
    expect(PasswordResetConfirmRequestSchema.safeParse({ email: "a@b.org", code: "123456", new_password: "long enough" }).success).toBe(true);
    expect(PasswordResetConfirmRequestSchema.safeParse({ token_hash: "pkce_abcdef0123456789", new_password: "long enough" }).success).toBe(true);
    expect(PasswordResetConfirmRequestSchema.safeParse({ email: "a@b.org", code: "123456", new_password: "short" }).success).toBe(false);
    expect(PasswordResetConfirmRequestSchema.safeParse({ code: "123456", new_password: "long enough" }).success).toBe(false);
    expect(PasswordResetConfirmResponseSchema.parse({ ok: true, email: null })).toEqual({ ok: true, email: null });
  });

  it("RESET_CODE_INVALID is a documented account error code", () => {
    expect(ACCOUNT_ERROR_CODES).toContain("RESET_CODE_INVALID");
  });
});
