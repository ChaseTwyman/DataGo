/**
 * Dashboard error → words. Pure (no React, no fetch) so the mapping is unit-tested.
 *
 * `ApiClientError` keeps the technical detail (`message`, `code`, `details`) for logs and tests;
 * the UI only ever renders `errorMessage(e)` / `fieldErrors(e)`, which never contain HTTP status
 * text, JSON, zod issue dumps, or exception strings.
 */
import { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** An error whose message was written for users (shown verbatim). */
export class FriendlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendlyError";
  }
}

/** Codes whose meaning we know → our copy. Server messages are not trusted to be presentable. */
const BY_CODE: Record<string, string> = {
  network: "Can't reach the GroundTruth server. Check your connection and try again.",
  contract_mismatch: "The server returned something unexpected. Refresh the page to try again.",
  UNAUTHORIZED: "Your session expired. Sign in again.",
  FORBIDDEN: "Your account doesn't have access to this.",
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  VALIDATION_FAILED: "Some fields need attention. Check the highlighted values and try again.",
  BAD_REQUEST: "That request wasn't accepted. Check the values and try again.",
  GROK_UNAVAILABLE: "The AI service is busy right now. Try again in a minute.",
  INTERNAL: "Something went wrong on our side. Try again in a moment.",
  BUDGET_EXHAUSTED: "This bounty's budget can't cover that payout. Raise the budget first.",
  NOT_IN_REVIEW: "Someone already reviewed this submission. The list will refresh.",
  ALREADY_PUBLISHED: "Published protocols can't be changed. Draft a new version instead.",
  NO_SOURCE: "Accept at least one real capture first — this attack replays an accepted observation.",
  BOUNTY_NOT_ACTIVE: "This bounty isn't accepting captures right now.",
  HAZARD_PAUSED: "Captures are paused here because of an active hazard warning.",
  FRAME_CHECK_LIMIT: "The scene-check limit for this session was reached.",
  // accounts (contracts/account.ts)
  EMAIL_TAKEN: "An account with this email already exists. Sign in instead.",
  INVALID_CREDENTIALS: "That password isn't right. Try again.",
  ACCOUNT_REQUIRED: "Create an account to continue.",
  ACCOUNT_SUSPENDED: "This account is suspended. Contact the GroundTruth team if you think this is a mistake.",
  RESEARCHER_REQUIRED: "Turn on researcher access in Account settings to use this.",
  ADMIN_REQUIRED: "Only administrators can do this.",
  RATE_LIMITED: "You've done that a lot in the last hour. Please wait a while and try again.",
  RESEARCHER_REVOKED: "An administrator turned off researcher access for this account. Contact the GroundTruth team.",
  CANNOT_CHANGE_SELF: "You can't remove your own admin access or suspend yourself. Ask another admin.",
};

function byStatus(status: number): string {
  if (status === 401) return BY_CODE.UNAUTHORIZED!;
  if (status === 403) return BY_CODE.FORBIDDEN!;
  if (status === 404) return BY_CODE.NOT_FOUND!;
  if (status === 409) return "This changed in the meantime. Refresh and try again.";
  if (status === 413) return "That file is too large.";
  if (status === 422 || status === 400) return BY_CODE.BAD_REQUEST!;
  if (status === 429) return "Too many requests. Wait a few seconds and try again.";
  if (status >= 500) return BY_CODE.INTERNAL!;
  return "Something went wrong. Please try again.";
}

export function errorMessage(e: unknown): string {
  if (e instanceof FriendlyError) return e.message;
  if (e instanceof ApiClientError) return BY_CODE[e.code] ?? byStatus(e.status);
  if (e instanceof z.ZodError) return BY_CODE.VALIDATION_FAILED!;
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return BY_CODE.network!;
  return "Something went wrong. Please try again.";
}

const FIELD_LABEL: Record<string, string> = {
  protocol_id: "Protocol",
  title: "Title",
  summary: "Summary",
  center_lat: "Latitude",
  center_lng: "Longitude",
  radius_m: "Radius",
  starts_at: "Start",
  ends_at: "End",
  base_price_cents: "Base price",
  max_price_cents: "Max price",
  target_per_cell: "Target per cell",
  priority: "Priority",
  budget_cents: "Budget",
  sponsor_name: "Sponsor name",
  sponsor_url: "Sponsor URL",
  email: "Email",
  password: "Password",
  new_password: "New password",
  current_password: "Current password",
  display_name: "Name",
  organization: "Organization",
  purpose: "Purpose",
  is_adult: "Age",
  accept_terms: "Terms",
};

type Issue = { path?: readonly PropertyKey[]; code?: string; message?: string; minimum?: unknown; maximum?: unknown; origin?: string; format?: string };

/** One human sentence per issue; never the raw zod message. */
function issueText(i: Issue): string {
  const field = String(i.path?.[0] ?? "");
  const cents = field.endsWith("_cents");
  const num = (v: unknown) => (typeof v === "number" || typeof v === "bigint" ? Number(v) : null);
  switch (i.code) {
    case "too_small": {
      const min = num(i.minimum);
      if (i.origin === "string") return min && min > 1 ? `Must be at least ${min} characters.` : "Required.";
      if (min === null) return "Too small.";
      return cents ? `Must be at least $${(min / 100).toFixed(2)}.` : `Must be at least ${min}.`;
    }
    case "too_big": {
      const max = num(i.maximum);
      if (i.origin === "string") return max ? `Must be at most ${max} characters.` : "Too long.";
      if (max === null) return "Too large.";
      return cents ? `Must be at most $${(max / 100).toFixed(2)}.` : `Must be at most ${max}.`;
    }
    case "invalid_format":
      if (i.format === "email") return "Enter a valid email address.";
      return i.format === "url" ? "Enter a full URL, like https://example.org." : "Invalid format.";
    case "invalid_type":
      return "Enter a valid value.";
    case "invalid_value":
      return "Choose one of the options.";
    default:
      return "Check this value.";
  }
}

/** Cross-field refinements from CreateBountyRequestSchema → the field they're about. */
function refinementField(i: Issue): string | null {
  const msg = i.message ?? "";
  if (/max_price_cents/.test(msg)) return "max_price_cents";
  if (/ends_at/.test(msg)) return "ends_at";
  return null;
}

const REFINEMENT_TEXT: Record<string, string> = {
  max_price_cents: "Max price must be at least the base price.",
  ends_at: "End must be after the start.",
};

/**
 * Field → message for form validation failures: a client-side ZodError, or a server 400/422
 * whose `details` carry zod issues. Empty when the error isn't a validation failure.
 */
export function fieldErrors(e: unknown): Record<string, string> {
  let issues: Issue[] = [];
  if (e instanceof z.ZodError) issues = e.issues as Issue[];
  else if (e instanceof ApiClientError && (e.status === 400 || e.status === 422) && Array.isArray(e.details)) issues = e.details as Issue[];
  const out: Record<string, string> = {};
  for (const i of issues) {
    if (!i || typeof i !== "object") continue;
    const refined = i.code === "custom" ? refinementField(i) : null;
    const key = refined ?? String(i.path?.[0] ?? "");
    if (!key || out[key]) continue;
    out[key] = refined ? REFINEMENT_TEXT[refined]! : issueText(i);
  }
  return out;
}

/** "Latitude: Must be at least -90." lines for fields the form doesn't render inline. */
export function fieldErrorSummary(errors: Record<string, string>): string {
  return Object.entries(errors)
    .map(([k, v]) => `${FIELD_LABEL[k] ?? k.replace(/_/g, " ")}: ${v}`)
    .join(" ");
}
