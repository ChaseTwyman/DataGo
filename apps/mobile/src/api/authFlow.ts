/**
 * Account/session decisions, pure (deps injected, unit-tested under node).
 *
 * Accounts are required (product decision 2026-09-26): email + password, no anonymous users.
 * - Supabase backend: a persisted, non-anonymous session → signed in; none → signed out (Welcome);
 *   a legacy anonymous session → signed out of it locally, Welcome explains accounts are required.
 * - Local backend (LOCAL_BACKEND=1, development only): POST /api/dev/session as before.
 */
import {
  EmailSchema,
  PasswordSchema,
  ResetCodeSchema,
  SignupRequestSchema,
  type LenientHealthResponse as HealthResponse,
  type SignupRequest,
} from "@groundtruth/shared";
import { ApiError } from "./http";

/** Why the Welcome screen is showing (drives its explanatory line). null = plain first launch. */
export type AuthNotice = "legacy_anonymous" | "account_required" | "session_ended" | "account_deleted";

export const NOTICE_COPY: Record<AuthNotice, string> = {
  legacy_anonymous: "Accounts are now required. Create an account or sign in to keep contributing.",
  account_required: "Accounts are now required. Create an account or sign in to keep contributing.",
  session_ended: "You've been signed out. Sign in again to continue.",
  account_deleted: "Your account was deleted. Thanks for contributing.",
};

export interface StoredSession {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
}

export interface AuthDeps {
  health: () => Promise<HealthResponse>;
  supabaseConfigured: boolean;
  /** The persisted Supabase session, if any (no network sign-in happens here). */
  supabaseSession: () => Promise<StoredSession | null>;
  /** Local sign-out (clears the persisted session). Must not throw. */
  supabaseSignOut: () => Promise<void>;
  devSession: (userId?: string) => Promise<{ user_id: string; access_token: string }>;
  loadDevUserId: () => Promise<string | null>;
  saveDevUserId: (id: string) => Promise<void>;
}

export type AuthResult =
  | { status: "signed_in"; health: HealthResponse; mode: "supabase" | "dev"; userId: string; devToken: string | null }
  | { status: "signed_out"; health: HealthResponse; mode: "supabase"; notice: AuthNotice | null };

/** Anonymous = flagged by Supabase, or no email at all (every real account has one). */
export const isLegacyAnonymous = (s: StoredSession): boolean => s.isAnonymous || !s.email;

export async function bootstrapAuth(d: AuthDeps): Promise<AuthResult> {
  const health = await d.health();
  if (health.backend === "supabase" && d.supabaseConfigured) {
    const s = await d.supabaseSession();
    if (!s) return { status: "signed_out", health, mode: "supabase", notice: null };
    if (isLegacyAnonymous(s)) {
      await d.supabaseSignOut();
      return { status: "signed_out", health, mode: "supabase", notice: "legacy_anonymous" };
    }
    return { status: "signed_in", health, mode: "supabase", userId: s.userId, devToken: null };
  }
  const saved = await d.loadDevUserId();
  let session: { user_id: string; access_token: string };
  try {
    session = await d.devSession(saved ?? undefined);
  } catch (e) {
    // A reset local DB forgets the user; start fresh rather than locking the app out.
    if (!saved) throw e;
    session = await d.devSession(undefined);
  }
  if (session.user_id !== saved) await d.saveDevUserId(session.user_id);
  return { status: "signed_in", health, mode: "dev", userId: session.user_id, devToken: session.access_token };
}

/**
 * What an API error means for the session. `null` = an ordinary error the screen handles.
 * - account_required: the server refuses this (anonymous/legacy) user → Welcome.
 * - session_ended: 401 that a silent refresh could not fix → Welcome ("signed out").
 * - suspended: the account is suspended → blocking screen.
 */
export type AuthFailure = "account_required" | "session_ended" | "suspended";

export function classifyAuthError(err: unknown): AuthFailure | null {
  if (!(err instanceof ApiError)) return null;
  if (err.code === "ACCOUNT_REQUIRED") return "account_required";
  if (err.code === "ACCOUNT_SUSPENDED") return "suspended";
  // Wrong current password on change-password is a 401 too, but the session is fine.
  if (err.status === 401 && err.code !== "INVALID_CREDENTIALS") return "session_ended";
  return null;
}

export type SessionAction = { type: "suspend" } | { type: "end"; notice: AuthNotice } | null;

/**
 * What the app does about an API error from an authenticated call. Only a signed-in session
 * reacts; Welcome exists only for Supabase accounts, so the local dev backend just surfaces it.
 */
export function sessionActionFor(err: unknown, s: { session: "signed_in" | "signed_out" | null; authMode: "supabase" | "dev" | null }): SessionAction {
  if (s.session !== "signed_in") return null;
  const kind = classifyAuthError(err);
  if (kind === "suspended") return { type: "suspend" };
  if (s.authMode !== "supabase" || !kind) return null;
  return { type: "end", notice: kind };
}

/** Codes where refreshing the token cannot help, so Http must not retry them. */
export const NO_REAUTH_CODES: ReadonlySet<string> = new Set(["ACCOUNT_REQUIRED", "ACCOUNT_SUSPENDED", "INVALID_CREDENTIALS"]);

/**
 * supabase-js auth errors (AuthApiError / AuthRetryableFetchError / …) → our ApiError codes so
 * toUserMessage has one mapping. Never carries Supabase's message text to the UI.
 */
export function mapSupabaseAuthError(e: unknown): ApiError {
  const o = (typeof e === "object" && e !== null ? e : {}) as { status?: unknown; code?: unknown; name?: unknown };
  const status = typeof o.status === "number" ? o.status : 0;
  const code = typeof o.code === "string" ? o.code : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (code === "invalid_credentials" || code === "email_not_confirmed" || code === "user_not_found") {
    return new ApiError(400, "INVALID_CREDENTIALS", "invalid credentials");
  }
  if (code === "user_banned") return new ApiError(403, "ACCOUNT_SUSPENDED", "suspended");
  if (status === 429 || code.startsWith("over_")) return new ApiError(429, "RATE_LIMITED", "rate limited");
  if (name === "AuthRetryableFetchError" || status === 0) return new ApiError(0, "NETWORK", "network");
  if (status === 400 && !code) return new ApiError(400, "INVALID_CREDENTIALS", "invalid credentials");
  if (status >= 500) return new ApiError(status, "SERVER", "auth server");
  return new ApiError(status || 400, "AUTH_FAILED", "auth failed");
}

// ---------------------------------------------------------------- sign-up form

export interface SignupForm {
  display_name: string;
  email: string;
  password: string;
  is_adult: boolean;
  accept_terms: boolean;
}
export type SignupField = keyof SignupForm;

/** Friendly per-field copy (the contract's own messages are used where they are already friendly). */
const FIELD_COPY: Record<SignupField, string> = {
  display_name: "Enter a display name.",
  email: "Enter a valid email address.",
  password: "Use at least 8 characters.",
  is_adult: "You must be 18 or older.",
  accept_terms: "Please accept the terms and data license.",
};

/** Validates with the shared SignupRequestSchema, so the phone never accepts what the server refuses. */
export function validateSignup(f: SignupForm): { ok: true; data: SignupRequest } | { ok: false; errors: Partial<Record<SignupField, string>> } {
  const r = SignupRequestSchema.safeParse(f);
  if (r.success) return { ok: true, data: r.data };
  const errors: Partial<Record<SignupField, string>> = {};
  for (const issue of r.error.issues) {
    const field = issue.path[0] as SignupField | undefined;
    if (!field || errors[field]) continue;
    errors[field] = field === "password" && f.password.length > 72 ? "Use at most 72 characters." : FIELD_COPY[field];
  }
  return { ok: false, errors };
}

// ---------------------------------------------------------------- forgot password

/**
 * Forgot password: email → code + new password → signed in. The code comes from Supabase's
 * recovery email and is redeemed by our server (POST /api/auth/password-reset/confirm), so no
 * deep link is needed. The request step never says whether the email has an account.
 */
export type ResetStep = "email" | "code" | "done";
export interface ResetState {
  step: ResetStep;
  /** The normalized address the code was sent to (the confirm call must use the same one). */
  sentTo: string | null;
  /** ms epoch of the last send, for the resend cooldown. */
  sentAt: number | null;
}
export type ResetEvent = { type: "sent"; email: string; at: number } | { type: "change_email" } | { type: "done" };

export const RESET_INITIAL: ResetState = { step: "email", sentTo: null, sentAt: null };

export function resetReducer(s: ResetState, e: ResetEvent): ResetState {
  switch (e.type) {
    case "sent":
      return { step: "code", sentTo: e.email, sentAt: e.at };
    case "change_email":
      return { ...s, step: "email" };
    case "done":
      return s.step === "code" ? { ...s, step: "done" } : s;
  }
}

/** Supabase refuses a second recovery email to the same user within 60 s. */
export const RESEND_COOLDOWN_MS = 60_000;
export const resendWaitSeconds = (s: ResetState, now: number): number =>
  s.sentAt === null ? 0 : Math.max(0, Math.ceil((s.sentAt + RESEND_COOLDOWN_MS - now) / 1000));

export type ResetField = "email" | "code" | "new_password" | "confirm_password";

export function validateResetEmail(email: string): { ok: true; email: string } | { ok: false; errors: Partial<Record<ResetField, string>> } {
  const r = EmailSchema.safeParse(email);
  return r.success ? { ok: true, email: r.data } : { ok: false, errors: { email: "Enter a valid email address." } };
}

export function validateResetForm(f: { code: string; password: string; confirm: string }):
  | { ok: true; code: string; password: string }
  | { ok: false; errors: Partial<Record<ResetField, string>> } {
  const errors: Partial<Record<ResetField, string>> = {};
  const c = ResetCodeSchema.safeParse(f.code);
  if (!c.success) errors.code = "Enter the 6-digit code from the email.";
  const p = PasswordSchema.safeParse(f.password);
  if (!p.success) errors.new_password = f.password.length > 72 ? "Use at most 72 characters." : "Use at least 8 characters.";
  else if (f.confirm !== f.password) errors.confirm_password = "The passwords don't match.";
  if (!c.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, code: c.data, password: f.password };
}

/** Delete-account gate: the user must type DELETE exactly (surrounding spaces from the keyboard ok). */
export const deleteConfirmed = (typed: string): boolean => typed.trim() === "DELETE";

// ---------------------------------------------------------------- root gate

export type GateView = "boot" | "welcome" | "loading_account" | "account_error" | "suspended" | "app";

export interface GateInput {
  ready: boolean;
  session: "signed_in" | "signed_out" | null;
  /** From GET /api/me (react-query). */
  me: { suspended: boolean } | null;
  meError: boolean;
  /** Set by a mid-use ACCOUNT_SUSPENDED even before /api/me refetches. */
  suspendedFlag: boolean;
}

/**
 * The only place that decides whether app screens mount. Anything other than "app" renders a
 * full-screen replacement (the router Stack is not mounted), so no deep link can reach a screen.
 */
export function gateView(i: GateInput): GateView {
  if (!i.ready || i.session === null) return "boot";
  if (i.session === "signed_out") return "welcome";
  if (i.suspendedFlag || i.me?.suspended) return "suspended";
  if (i.me) return "app";
  return i.meError ? "account_error" : "loading_account";
}

/** Researcher dashboard lives on the same origin as the API (Next.js app). */
export function dashboardUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "").replace(/\/api$/, "") || apiBaseUrl;
}
