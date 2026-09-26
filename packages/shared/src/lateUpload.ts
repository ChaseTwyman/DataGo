/**
 * Late (queued) uploads. Capture itself is never offline: the server-authoritative gate must pass
 * online before the shutter unlocks. What the phone may queue is the UPLOAD + SUBMIT of a burst taken
 * in a gate-passed session, when signal drops afterwards.
 *
 * Server rule (submission route + session-integrity stage):
 *   - on time: received ≤ expires_at + skew (unchanged)
 *   - late:    received ≤ expires_at + LATE_UPLOAD_GRACE_MIN, ONLY if the session's gate_passed_at is
 *              set, captured_at lies inside the session window, and not before the gate passed.
 *   - anything else is refused; a session that never passed the gate never gets the grace.
 *
 * 90 minutes (not 2 h) because the signed upload URLs are issued when the session opens and live 2 h
 * (Supabase createSignedUploadUrl default; lib/storage/supabase.ts passes no expiry, so this relies on
 * the SDK default — if it ever shrinks, raise the expiry there or lower this): 15 min session + 90 min
 * grace ends before they expire.
 */
export const LATE_UPLOAD_GRACE_MIN = 90;
/** Clock skew tolerated between phone and server (same as the session-integrity stage). */
export const CLOCK_SKEW_MS = 2 * 60_000;

export interface LateUploadSession {
  started_at: string;
  expires_at: string;
  gate_passed_at: string | null;
}

export type LateUploadVerdict =
  | { ok: true; late: boolean }
  | { ok: false; code: "UPLOAD_GRACE_EXPIRED" | "GATE_NOT_PASSED" | "CAPTURE_OUTSIDE_SESSION"; message: string };

export function judgeLateUpload(s: LateUploadSession, capturedAt: string, receivedAt: Date): LateUploadVerdict {
  const received = receivedAt.getTime();
  const end = Date.parse(s.expires_at);
  if (received <= end + CLOCK_SKEW_MS) return { ok: true, late: false };
  if (!s.gate_passed_at) {
    return { ok: false, code: "GATE_NOT_PASSED", message: "This capture session never passed the live scene check, so it can't be sent after it closed" };
  }
  if (received > end + LATE_UPLOAD_GRACE_MIN * 60_000) {
    return { ok: false, code: "UPLOAD_GRACE_EXPIRED", message: "This capture was saved too long ago to send. Please capture again." };
  }
  const captured = Date.parse(capturedAt);
  const start = Date.parse(s.started_at);
  const gate = Date.parse(s.gate_passed_at);
  if (!Number.isFinite(captured) || captured < Math.max(start, gate) - CLOCK_SKEW_MS || captured > end + CLOCK_SKEW_MS || captured > received + CLOCK_SKEW_MS) {
    return { ok: false, code: "CAPTURE_OUTSIDE_SESSION", message: "The capture time is outside its session" };
  }
  return { ok: true, late: true };
}

/** Phone side: the last moment a queued capture may still be sent (then it is discarded). */
export function lateUploadDeadline(sessionExpiresAt: string): number {
  return Date.parse(sessionExpiresAt) + LATE_UPLOAD_GRACE_MIN * 60_000;
}
