/**
 * Forgot-password form logic for /reset-password, pure (no React, no fetch) so it's unit-tested.
 * Validation uses the shared contract schemas, so the form never accepts what the server refuses.
 */
import { EmailSchema, PasswordSchema, ResetCodeSchema } from "@groundtruth/shared";

export type ResetField = "email" | "code" | "new_password" | "confirm_password";
export type ResetErrors = Partial<Record<ResetField, string>>;

export function validateResetEmail(email: string): { ok: true; email: string } | { ok: false; errors: ResetErrors } {
  const r = EmailSchema.safeParse(email);
  return r.success ? { ok: true, email: r.data } : { ok: false, errors: { email: "Enter a valid email address." } };
}

export interface ResetConfirmForm {
  /** Absent when the page was opened from the email's link (token_hash). */
  code?: string;
  password: string;
  confirm: string;
}

export function validateResetConfirm(f: ResetConfirmForm): { ok: true; code: string | null; password: string } | { ok: false; errors: ResetErrors } {
  const errors: ResetErrors = {};
  let code: string | null = null;
  if (f.code !== undefined) {
    const c = ResetCodeSchema.safeParse(f.code);
    if (c.success) code = c.data;
    else errors.code = "Enter the 6-digit code from the email.";
  }
  const p = PasswordSchema.safeParse(f.password);
  if (!p.success) errors.new_password = f.password.length > 72 ? "Use at most 72 characters." : "Use at least 8 characters.";
  else if (f.confirm !== f.password) errors.confirm_password = "The passwords don't match.";
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, code, password: f.password };
}

export type ResetLink =
  /** /reset-password?token_hash=… from the email: only the new password is needed. */
  | { kind: "token"; tokenHash: string }
  /** Supabase's own verify link already redeemed the token (or it expired): ask for a new code. */
  | { kind: "used" }
  /** Plain visit ("Forgot password?"), optionally with ?email= to prefill. */
  | { kind: "none"; email: string };

/**
 * What the URL carries. `search` and `hash` as in `location.search` / `location.hash`.
 * - `?token_hash=…&type=recovery` (our template's link) → token.
 * - `#error_code=otp_expired…` or `#access_token=…&type=recovery` ({{ .ConfirmationURL }} after
 *   Supabase already verified it) → used: that token is spent, and so is the emailed code.
 */
export function parseResetLink(search: string, hash: string): ResetLink {
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const tokenHash = q.get("token_hash")?.trim();
  const type = q.get("type");
  if (tokenHash && (!type || type === "recovery")) return { kind: "token", tokenHash };
  if (h.get("error_code") || h.get("error") || q.get("error_code") || h.get("access_token")) return { kind: "used" };
  return { kind: "none", email: q.get("email")?.trim() ?? "" };
}
