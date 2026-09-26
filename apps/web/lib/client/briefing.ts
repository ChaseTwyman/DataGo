/**
 * Briefing clip (PRD §7.3) polling logic. Pure except a module-level map that keeps in-flight renders
 * across page navigation, so leaving a bounty and coming back resumes the "rendering" state.
 *
 * POST /api/bounties/:id/briefing-video answers 202 immediately; the server polls Grok Imagine and
 * stores the clip in the background, then sets bounty.briefing_video_path. The dashboard can only
 * see BountyDetail.briefing_video_url, so "done" = that URL points at a different stored object than
 * before the request (each render is stored under its own path; lib/briefing.ts).
 */
import { errorMessage } from "./errors";

export const BRIEFING_TIMEOUT_MS = 6 * 60_000;
export const BRIEFING_POLL_MS = 10_000;

export type BriefingState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "rendering"; startedAt: number; baselineKey: string | null }
  | { phase: "ready" }
  | { phase: "timeout" }
  | { phase: "error"; message: string };

/**
 * The stored object a media URL points at, ignoring tokens that change on every fetch: the dev
 * media route carries it in `?path=`, Supabase public/signed URLs in the pathname.
 */
export function videoKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.searchParams.get("path") ?? `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

export function startRendering(currentUrl: string | null | undefined, now: number): BriefingState {
  return { phase: "rendering", startedAt: now, baselineKey: videoKey(currentUrl) };
}

export function startFailed(e: unknown): BriefingState {
  return { phase: "error", message: errorMessage(e) };
}

/** One poll result → next state. Only "rendering" moves; everything else is terminal until a user action. */
export function briefingTick(s: BriefingState, currentUrl: string | null | undefined, now: number, timeoutMs = BRIEFING_TIMEOUT_MS): BriefingState {
  if (s.phase !== "rendering") return s;
  const key = videoKey(currentUrl);
  if (key && key !== s.baselineKey) return { phase: "ready" };
  if (now - s.startedAt > timeoutMs) return { phase: "timeout" };
  return s;
}

const inflight = new Map<string, BriefingState>();

export function rememberBriefing(bountyId: string, s: BriefingState): void {
  if (s.phase === "rendering") inflight.set(bountyId, s);
  else inflight.delete(bountyId);
}

export function rememberedBriefing(bountyId: string): BriefingState {
  return inflight.get(bountyId) ?? { phase: "idle" };
}

export function forgetBriefing(bountyId: string): void {
  inflight.delete(bountyId);
}
