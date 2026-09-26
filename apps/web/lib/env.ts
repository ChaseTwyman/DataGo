/** Server env flags. Read lazily so tests can stub them per case. */
import { isDemoMode, isMockGrok } from "./grok/config";

export { isDemoMode, isMockGrok };

const truthy = (v: string | undefined) => v === "1" || v === "true";

/** LOCAL_BACKEND=1: PGlite + filesystem storage + dev auth. Never enable on a shared deployment. */
export function isLocalBackend(): boolean {
  return truthy(process.env.LOCAL_BACKEND);
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

/** Secret for HMAC-signing local storage URLs. Only meaningful in LOCAL_BACKEND mode. */
export function localSigningSecret(): string {
  return process.env.LOCAL_SIGNING_SECRET || "groundtruth-local-dev-secret";
}

/** Disable outbound context/hazard HTTP calls (offline dev). Pipeline marks those subchecks skipped. */
export function isOffline(): boolean {
  return truthy(process.env.OFFLINE_CONTEXT);
}
