/** Server env flags. Read lazily so tests can stub them per case. */
import { randomBytes } from "node:crypto";
import { isDemoMode, isMockGrok } from "./grok/config";

export { isDemoMode, isMockGrok };

const truthy = (v: string | undefined) => v === "1" || v === "true";

/** LOCAL_BACKEND=1: PGlite + filesystem storage + dev auth. Never enable on a shared deployment. */
export function isLocalBackend(): boolean {
  return truthy(process.env.LOCAL_BACKEND);
}

/**
 * MOCK_GROK approves anything. It once "accepted" a capture against the hosted database and the row
 * reached the public dataset. So mock mode is refused unless the DB is local PGlite, or someone
 * explicitly opts in with ALLOW_MOCK_ON_REAL_DB=1 (e.g. an e2e run against a scratch project; the
 * rows are still marked verifier='mock' and never exported or published).
 */
export class MockOnRealDbError extends Error {
  constructor() {
    super(
      "Refusing to run with MOCK_GROK=1 against a non-local database (LOCAL_BACKEND is not 1): mock verification " +
        "approves anything and would write fake 'accepted' rows. Set MOCK_GROK=0, or LOCAL_BACKEND=1, or " +
        "ALLOW_MOCK_ON_REAL_DB=1 if you really mean it (mock rows are marked verifier='mock' and never published).",
    );
    this.name = "MockOnRealDbError";
  }
}

export function assertMockGrokAllowed(): void {
  if (isMockGrok() && !isLocalBackend() && !truthy(process.env.ALLOW_MOCK_ON_REAL_DB)) throw new MockOnRealDbError();
}

/**
 * Whether frame-check results may count toward the server-side capture gate. Mock fixtures are
 * always green, so they count only on the local backend (dev/tests), never against a real DB.
 */
export function frameChecksCountTowardGate(): boolean {
  return !isMockGrok() || isLocalBackend();
}

/** NWS events that pause captures (in addition to severity=Extreme). */
export function hazardPauseEvents(): string[] {
  const raw = process.env.HAZARD_PAUSE_EVENTS;
  const list = raw && raw.trim() ? raw : "Flash Flood Emergency,Tornado Warning,Tornado Emergency,Extreme Wind Warning";
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function nwsUserAgent(): string {
  return process.env.NWS_USER_AGENT || "GroundTruth hackathon (groundtruth@example.com)";
}

const g = globalThis as typeof globalThis & { __gtSigningSecret?: string };

/**
 * Secret for HMAC-signing local storage URLs (LOCAL_BACKEND only). Never a committed constant: when
 * LOCAL_SIGNING_SECRET is unset, a random per-process secret is used, so URLs die with the server.
 */
export function localSigningSecret(): string {
  return process.env.LOCAL_SIGNING_SECRET || (g.__gtSigningSecret ??= randomBytes(32).toString("hex"));
}

/** Disable outbound context/hazard HTTP calls (offline dev). Pipeline marks those subchecks skipped. */
export function isOffline(): boolean {
  return truthy(process.env.OFFLINE_CONTEXT);
}
