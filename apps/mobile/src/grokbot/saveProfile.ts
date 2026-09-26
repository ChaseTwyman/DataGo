import type { ProfileRequest } from "@groundtruth/shared";
import { api } from "../api";
import { queryClient } from "../api/queryClient";
import { log } from "../lib/log";
import { saveProfileAndRefresh } from "./profile";

/**
 * POST /api/profile, then (fire-and-forget) POST /api/grokbot/match/refresh; when the refresh
 * lands, the For-you list is refetched so new match reasons show. Refresh errors are ignored.
 */
export function saveProfile(body: ProfileRequest): Promise<void> {
  return saveProfileAndRefresh(
    {
      saveProfile: api.profile,
      refreshMatches: api.matchRefresh,
      onRefreshed: () => void queryClient.invalidateQueries({ queryKey: ["nearby"] }),
      onRefreshError: (e) => log.handled("match-refresh", e),
    },
    body,
  );
}
