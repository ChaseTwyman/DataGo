/** App-wide API singleton + startup bootstrap. */
import { ENV } from "../lib/env";
import { log } from "../lib/log";
import { getSupabase, supabaseAccessToken, supabaseAnonymousSignIn, supabaseConfigured } from "../lib/supabase";
import { devUserStore, loadPersisted, useApp } from "../state/appStore";
import { bootstrapAuth } from "./authFlow";
import { endpoints } from "./endpoints";
import { toUserMessage } from "./errors";
import { Http, type FetchLike } from "./http";

let renewing: Promise<boolean> | null = null;

/**
 * Silent re-auth after a 401 (expired/revoked token): refresh the Supabase session (same anonymous
 * user, so the wallet is kept) or re-issue the dev session for the persisted dev user. Concurrent
 * 401s share one renewal.
 */
function reauth(): Promise<boolean> {
  if (renewing) return renewing;
  renewing = (async () => {
    try {
      const s = useApp.getState();
      if (s.authMode === "supabase") {
        const sb = getSupabase();
        const { data, error } = await sb.auth.refreshSession();
        if (!error && data.session) return true;
        // No refreshable session at all (e.g. keychain cleared): sign in again.
        await supabaseAnonymousSignIn();
        return true;
      }
      if (s.authMode === "dev") {
        const d = await api.devSession(s.userId ?? undefined);
        useApp.getState().setBoot({ devToken: d.access_token, userId: d.user_id });
        return true;
      }
      return false;
    } catch (e) {
      log.handled("reauth", e);
      return false;
    } finally {
      setTimeout(() => {
        renewing = null;
      }, 0);
    }
  })();
  return renewing;
}

const http = new Http({
  baseUrl: ENV.apiBaseUrl,
  fetch: fetch as unknown as FetchLike,
  getToken: async () => {
    const s = useApp.getState();
    if (s.authMode === "supabase") return supabaseAccessToken();
    return s.devToken;
  },
  getMockVariant: () => (__DEV__ ? useApp.getState().mockVariant : null),
  reauth,
});

export const api = endpoints(http);
export { ApiError } from "./http";
export { toUserMessage, userMessageText, UserFacingError } from "./errors";

let booting: Promise<void> | null = null;

/** GET /api/health → Supabase anonymous auth or a dev session. Idempotent. */
export function boot(): Promise<void> {
  if (booting) return booting;
  booting = (async () => {
    useApp.getState().setBoot({ bootError: null });
    try {
      await loadPersisted();
      const r = await bootstrapAuth({
        health: api.health,
        supabaseConfigured: supabaseConfigured(),
        supabaseSignIn: supabaseAnonymousSignIn,
        devSession: api.devSession,
        loadDevUserId: devUserStore.load,
        saveDevUserId: devUserStore.save,
      });
      useApp.getState().setBoot({
        ready: true,
        health: r.health,
        authMode: r.mode,
        userId: r.userId,
        devToken: r.devToken,
      });
    } catch (e) {
      log.handled("boot", e);
      useApp.getState().setBoot({ ready: false, bootError: toUserMessage(e).message });
      booting = null;
    }
  })();
  return booting;
}
