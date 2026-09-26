/**
 * DB-backed fixed-window rate limits (table public.rate_limits, migration 000006). In-memory counters
 * don't work on serverless (every instance has its own), so each hit is one atomic upsert.
 * Fixed windows allow up to 2x the limit across a window boundary; fine for abuse damping.
 */
import { HttpError } from "./api/http";
import type { Db } from "./db";

export interface Limit {
  /** Counter namespace, e.g. "signup". */
  name: string;
  max: number;
  windowSeconds: number;
  /** User-facing noun for the message ("sign-ups", "captures"). */
  what: string;
}

const HOUR = 3600;
export const LIMITS = {
  signup: { name: "signup", max: 5, windowSeconds: HOUR, what: "sign-ups from this network" },
  captureSession: { name: "capture_session", max: 30, windowSeconds: HOUR, what: "capture sessions" },
  submission: { name: "submission", max: 20, windowSeconds: HOUR, what: "submissions" },
  protocolDraft: { name: "protocol_draft", max: 10, windowSeconds: HOUR, what: "protocol drafts" },
  redteam: { name: "redteam", max: 20, windowSeconds: HOUR, what: "red-team runs" },
  // Each request can trigger an automatic pool allocation; damp request spam (sponsor pool, 000007).
  dataRequest: { name: "data_request", max: 20, windowSeconds: HOUR, what: "data requests" },
  pricingPreview: { name: "pricing_preview", max: 600, windowSeconds: HOUR, what: "price previews" },
  // Not in the brief; stops online guessing of the current password through this route.
  passwordChange: { name: "password_change", max: 10, windowSeconds: HOUR, what: "password attempts" },
  // Forgot password. Per email (normalized) caps mail sent to one inbox and code guesses against
  // one account; per IP caps one client spraying many emails. Counted whether or not the email has
  // an account, so a 429 reveals nothing. 10 guesses/hour at a 6-digit code ≈ 1e-5 per hour.
  resetRequestIp: { name: "reset_request_ip", max: 10, windowSeconds: HOUR, what: "password reset requests from this network" },
  resetRequestEmail: { name: "reset_request_email", max: 5, windowSeconds: HOUR, what: "password reset emails for this address" },
  resetConfirmIp: { name: "reset_confirm_ip", max: 30, windowSeconds: HOUR, what: "reset code attempts from this network" },
  resetConfirmEmail: { name: "reset_confirm_email", max: 10, windowSeconds: HOUR, what: "reset code attempts for this address" },
  // Grokbot. Reads are cached per case-file version, so only a changed case costs a model call; the
  // cap bounds a client that polls narration in a loop (a verify is ~20 polls).
  grokbot: { name: "grokbot", max: 600, windowSeconds: HOUR, what: "assistant requests" },
  matchRefresh: { name: "match_refresh", max: 10, windowSeconds: HOUR, what: "match refreshes" },
  // Background refreshes kicked by /nearby or a profile change: silent, never a 429 to the client.
  matchAuto: { name: "match_auto", max: 6, windowSeconds: HOUR, what: "automatic match refreshes" },
  // Up to 1 image generation + 4 vision calls each.
  selfCheck: { name: "self_check", max: 10, windowSeconds: HOUR, what: "protocol self-checks" },
  publicImpact: { name: "public_impact", max: 120, windowSeconds: HOUR, what: "impact report requests from this network" },
} as const satisfies Record<string, Limit>;

export function rateLimited(limit: Limit): HttpError {
  const mins = Math.round(limit.windowSeconds / 60);
  const window = mins >= 60 ? `${Math.round(mins / 60)} hour${mins >= 120 ? "s" : ""}` : `${mins} minutes`;
  return new HttpError(429, "RATE_LIMITED", `Too many ${limit.what} for now (limit ${limit.max} per ${window}). Please try again later.`);
}

/** Counts one hit for `subject`; throws 429 RATE_LIMITED once the window's count exceeds the max. */
export async function enforceRateLimit(db: Db, limit: Limit, subject: string): Promise<void> {
  if (process.env.RATE_LIMITS_DISABLED === "1" && process.env.LOCAL_BACKEND === "1") return;
  const rows = await db.query<{ n: number }>("select public.rate_limit_hit($1, $2) as n", [`${limit.name}:${subject}`, limit.windowSeconds]);
  const n = Number(rows[0]?.n ?? 0);
  if (n > limit.max) throw rateLimited(limit);
}

/** Client IP as Vercel reports it (x-real-ip / first x-forwarded-for hop). */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
}

/** Drops windows older than a day (called by the retention cron). */
export async function pruneRateLimits(db: Db): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "with d as (delete from public.rate_limits where window_start < now() - interval '1 day' returning 1) select count(*)::int as n from d",
  );
  return rows[0]?.n ?? 0;
}
