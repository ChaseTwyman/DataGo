/**
 * The ONE place that turns a thrown value into words a contributor sees. Pure (unit-tested).
 *
 * Rule: never show exception text, HTTP status text, JSON, or zod issues. Server `message`s are
 * shown only for the codes whose copy we own and know is human-readable (see SERVER_COPY).
 */
import { UploadError } from "../capture/upload";
import { ApiError } from "./http";

/** An error whose message was written for users (safe to show verbatim). */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly title = "Something needs attention",
    readonly retryable = true,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

export interface UserMessage {
  title: string;
  message: string;
  /** Whether "Try again" can plausibly help. */
  retryable: boolean;
  /** Stable machine code (for logs/tests), never shown. */
  code: string;
}

const m = (code: string, title: string, message: string, retryable = true): UserMessage => ({ code, title, message, retryable });

/** Codes whose meaning we know → our own copy (the server's text is not trusted to be friendly). */
const BY_CODE: Record<string, UserMessage> = {
  NETWORK: m("NETWORK", "You're offline", "We couldn't reach GroundTruth. Check your connection and try again."),
  TIMEOUT: m("TIMEOUT", "Taking too long", "The server is slow to respond right now. Try again in a moment."),
  UNAUTHORIZED: m("UNAUTHORIZED", "Signed out", "Your session expired. Try again and we'll reconnect you."),
  FORBIDDEN: m("FORBIDDEN", "Not available", "Your account can't do that.", false),
  NOT_FOUND: m("NOT_FOUND", "Not found", "This is no longer available. It may have ended or been removed.", false),
  OUTSIDE_AREA: m("OUTSIDE_AREA", "Outside the bounty area", "You're outside the bounty area. Move inside the highlighted hexes and try again."),
  BOUNTY_NOT_ACTIVE: m("BOUNTY_NOT_ACTIVE", "Bounty not open", "This bounty isn't accepting captures right now. It may be waiting for funding or have ended — try another bounty nearby.", false),
  HAZARD_PAUSED: m("HAZARD_PAUSED", "Paused for safety", "Captures are paused here because of an active hazard warning.", false),
  // Economy: the sponsor pool behind this bounty is spent (or not yet funded). Not the contributor's
  // fault and not permanent — pools get topped up.
  BUDGET_EXHAUSTED: m(
    "BUDGET_EXHAUSTED",
    "Fully funded for now",
    "This bounty's budget is used up for the moment, so it can't pay for new captures. Sponsors top up pools regularly — check back later, or pick another bounty nearby.",
    false,
  ),
  PENDING_FUNDING: m(
    "PENDING_FUNDING",
    "Waiting for funding",
    "This bounty is waiting for sponsor funding before it can pay for captures. Check back later, or pick another bounty nearby.",
    false,
  ),
  SESSION_CLOSED: m("SESSION_CLOSED", "Session ended", "This capture session has ended. Start a new capture from the briefing.", false),
  SESSION_ABANDONED: m("SESSION_ABANDONED", "Session replaced", "You started a newer capture on this bounty, which closed this one. Capture again from the briefing.", false),
  UPLOAD_GRACE_EXPIRED: m("UPLOAD_GRACE_EXPIRED", "Too late to send", "This capture was saved too long ago to send. Please capture again.", false),
  CAPTURE_OUTSIDE_SESSION: m("CAPTURE_OUTSIDE_SESSION", "Couldn't send this capture", "This capture doesn't match its session. Please capture again.", false),
  GATE_NOT_PASSED: m("GATE_NOT_PASSED", "Couldn't send this capture", "The live scene check never passed in this session, so it can't be sent after the session closed. Please capture again.", false),
  NOT_ACCEPTED: m("NOT_ACCEPTED", "Not verified yet", "Impact cards are available once an observation is accepted.", false),
  SESSION_ALREADY_SUBMITTED: m("SESSION_ALREADY_SUBMITTED", "Already submitted", "This capture was already submitted. Start a new capture from the briefing.", false),
  FRAME_CHECK_LIMIT: m("FRAME_CHECK_LIMIT", "Scene-check limit reached", "End this session and start a new one.", false),
  FRAME_CHECK_IN_FLIGHT: m("FRAME_CHECK_IN_FLIGHT", "One moment", "A scene check is already running."),
  RATE_LIMITED: m("RATE_LIMITED", "Too many requests", "Wait a few seconds and try again."),
  EMAIL_TAKEN: m("EMAIL_TAKEN", "Email already registered", "An account with this email already exists. Sign in instead.", false),
  INVALID_CREDENTIALS: m("INVALID_CREDENTIALS", "Couldn't sign in", "That email and password don't match. Check them and try again.", false),
  ACCOUNT_REQUIRED: m("ACCOUNT_REQUIRED", "Account needed", "Accounts are now required. Create an account or sign in to keep contributing.", false),
  ACCOUNT_SUSPENDED: m("ACCOUNT_SUSPENDED", "Account suspended", "This account is suspended. Contact a GroundTruth admin for help.", false),
  RESET_CODE_INVALID: m("RESET_CODE_INVALID", "Code didn't work", "That code is wrong or has expired. Check the latest email, or send a new code."),
  AUTH_FAILED: m("AUTH_FAILED", "Couldn't sign in", "Something went wrong signing in. Try again in a moment."),
  GROK_UNAVAILABLE: m("GROK_UNAVAILABLE", "AI service busy", "Our AI service is busy right now. Try again in a minute."),
  VALIDATION_FAILED: m("VALIDATION_FAILED", "Couldn't send that", "Something in the request wasn't accepted. Try again, or restart the capture."),
  BAD_REQUEST: m("BAD_REQUEST", "Couldn't send that", "Something in the request wasn't accepted. Try again, or restart the capture."),
  SYNTHETIC_MEDIA: m("SYNTHETIC_MEDIA", "Couldn't submit", "Only photos taken in the app can be submitted. Start a new capture.", false),
  CONTRACT_MISMATCH: m("CONTRACT_MISMATCH", "Unexpected response", "The server sent something this version of the app can't read. Try again, or update the app."),
  BAD_JSON: m("BAD_JSON", "Unexpected response", "The server sent something this version of the app can't read. Try again, or update the app."),
  SERVER: m("SERVER", "Something went wrong", "That's on our side, not yours. Try again in a moment."),
  UNKNOWN: m("UNKNOWN", "Something went wrong", "Please try again."),
};

// Spellings a newer economy server might use for the same refusals.
BY_CODE.NOT_FUNDED = BY_CODE.PENDING_FUNDING!;
BY_CODE.BOUNTY_PENDING_FUNDING = BY_CODE.PENDING_FUNDING!;
BY_CODE.POOL_EXHAUSTED = BY_CODE.BUDGET_EXHAUSTED!;

function byStatus(status: number): UserMessage | null {
  if (status === 401) return BY_CODE.UNAUTHORIZED!;
  if (status === 403) return BY_CODE.FORBIDDEN!;
  if (status === 404) return BY_CODE.NOT_FOUND!;
  if (status === 408) return BY_CODE.TIMEOUT!;
  if (status === 409) return m("CONFLICT", "Already changed", "This changed in the meantime. Go back and try again.", false);
  if (status === 413) return m("TOO_LARGE", "Photo too large", "That photo is too large to upload. Try the capture again.");
  if (status === 422) return BY_CODE.VALIDATION_FAILED!;
  if (status === 429) return BY_CODE.RATE_LIMITED!;
  // 502 with code GROK_UNAVAILABLE is matched by code first; a bare 5xx (proxy, crash) is ours.
  if (status >= 500) return BY_CODE.SERVER!;
  if (status >= 400) return BY_CODE.BAD_REQUEST!;
  return null;
}

/** Map anything thrown to calm, specific, actionable copy. Never returns raw error text. */
export function toUserMessage(err: unknown): UserMessage {
  if (err instanceof UserFacingError) return { code: "USER", title: err.title, message: err.message, retryable: err.retryable };
  if (err instanceof ApiError) {
    const known = BY_CODE[err.code];
    if (known) return known;
    return byStatus(err.status) ?? BY_CODE.UNKNOWN!;
  }
  if (err instanceof UploadError) {
    return m("UPLOAD", "Upload didn't finish", "Your photos are saved on this phone. Check your connection, then tap Submit to try again.");
  }
  // fetch/TypeError "Network request failed" from code that bypassed Http (uploads, sockets).
  if (err instanceof Error && /network request failed|network error|offline|internet connection/i.test(err.message)) return BY_CODE.NETWORK!;
  if (err instanceof Error && /timed? ?out|timeout/i.test(err.message)) return BY_CODE.TIMEOUT!;
  return BY_CODE.UNKNOWN!;
}

/**
 * Forgot-password screens: the reset limits are hourly, so "wait a few seconds" would be wrong.
 * Everything else maps as usual.
 */
export function toResetMessage(err: unknown): UserMessage {
  const msg = toUserMessage(err);
  if (msg.code === "RATE_LIMITED") return m("RATE_LIMITED", "Too many attempts", "Too many reset attempts for now. Wait a while (up to an hour) and try again.");
  return msg;
}

/** Just the sentence, for inline pills. */
export const userMessageText = (err: unknown): string => toUserMessage(err).message;

/** True for failures where a quiet background retry is the right response (no error wall). */
export function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
  return !(err instanceof UserFacingError);
}
