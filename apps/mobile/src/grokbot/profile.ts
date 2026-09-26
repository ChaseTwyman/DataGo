/**
 * Profile → For-you personalization (Grokbot Phase 3). Pure, unit-tested.
 * After a profile save, POST /api/grokbot/match/refresh fire-and-forget: the save itself is what
 * the contributor waits for; a failed (or not yet deployed) refresh is ignored — the server's
 * match cache catches up on its own.
 */
import type { ProfileRequest } from "@groundtruth/shared";

/** "a, b,, c" → ["a","b","c"] within the contract's limits (≤ 30 items, ≤ 60 chars each). */
export function splitList(s: string, max = 30, maxLen = 60): string[] {
  return [
    ...new Set(
      s
        .split(/[,\n;]/)
        .map((x) => x.replace(/\s+/g, " ").trim().slice(0, maxLen))
        .filter(Boolean),
    ),
  ].slice(0, max);
}

/** Regular areas as typed ("Midtown, Piedmont Park") → the contract's {label, description}[] (≤ 10). */
export function areasFromText(s: string): { label: string; description: string }[] {
  return splitList(s, 10, 80).map((label) => ({ label, description: "" }));
}

export const joinList = (xs: readonly string[] | null | undefined): string => (xs ?? []).join(", ");

export interface ProfileSaveDeps {
  saveProfile: (body: ProfileRequest) => Promise<unknown>;
  refreshMatches: () => Promise<unknown>;
  /** Refresh succeeded (e.g. refetch the For-you list so new match reasons show). */
  onRefreshed?: () => void;
  onRefreshError?: (e: unknown) => void;
}

/** Awaits the save (its errors propagate); the refresh is started, never awaited, never thrown. */
export async function saveProfileAndRefresh(deps: ProfileSaveDeps, body: ProfileRequest): Promise<void> {
  await deps.saveProfile(body);
  try {
    void deps
      .refreshMatches()
      .then(() => deps.onRefreshed?.())
      .catch((e: unknown) => deps.onRefreshError?.(e));
  } catch (e) {
    deps.onRefreshError?.(e);
  }
}
