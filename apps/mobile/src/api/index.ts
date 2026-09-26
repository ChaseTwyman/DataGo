/** App-wide API singleton + startup bootstrap. */
import { ENV } from "../lib/env";
import { supabaseAccessToken, supabaseAnonymousSignIn, supabaseConfigured } from "../lib/supabase";
import { devUserStore, loadPersisted, useApp } from "../state/appStore";
import { bootstrapAuth } from "./authFlow";
import { endpoints } from "./endpoints";
import { Http, type FetchLike } from "./http";

const http = new Http({
  baseUrl: ENV.apiBaseUrl,
  fetch: fetch as unknown as FetchLike,
  getToken: async () => {
    const s = useApp.getState();
    if (s.authMode === "supabase") return supabaseAccessToken();
    return s.devToken;
  },
  getMockVariant: () => (__DEV__ ? useApp.getState().mockVariant : null),
});

export const api = endpoints(http);
export { ApiError } from "./http";

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
      useApp.getState().setBoot({
        ready: false,
        bootError: `${e instanceof Error ? e.message : String(e)} — API: ${ENV.apiBaseUrl}`,
      });
      booting = null;
    }
  })();
  return booting;
}
