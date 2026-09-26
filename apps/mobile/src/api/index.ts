/** App-wide API singleton, startup bootstrap, and account session actions. */
import { ENV } from "../lib/env";
import { log } from "../lib/log";
import { getSupabase, supabaseAccessToken, supabaseConfigured, supabasePasswordSignIn, supabaseSignOut, supabaseStoredSession } from "../lib/supabase";
import { devUserStore, lastAccountStore, loadPersisted, useApp } from "../state/appStore";
import { bootstrapAuth, isLegacyAnonymous, NO_REAUTH_CODES, sessionActionFor, type AuthNotice } from "./authFlow";
import { endpoints } from "./endpoints";
import { toUserMessage, UserFacingError } from "./errors";
import { Http, type ApiError, type FetchLike } from "./http";
import { queryClient } from "./queryClient";

let renewing: Promise<boolean> | null = null;

/**
 * Silent re-auth after a 401 (expired token): refresh the Supabase session, or re-issue the dev
 * session. There is no anonymous fallback any more: an unrefreshable session means signed out.
 * Concurrent 401s share one renewal.
 */
function reauth(): Promise<boolean> {
  if (renewing) return renewing;
  renewing = (async () => {
    try {
      const s = useApp.getState();
      if (s.authMode === "supabase") {
        const { data, error } = await getSupabase().auth.refreshSession();
        return !error && !!data.session;
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

/** Session consequences of an API error, wherever in the app it happened. */
function onAuthedError(e: ApiError): void {
  const s = useApp.getState();
  const action = sessionActionFor(e, s);
  if (action?.type === "suspend") {
    s.setBoot({ suspended: true });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  } else if (action?.type === "end") {
    void endSession(action.notice);
  }
}

const http = new Http({
  baseUrl: ENV.apiBaseUrl,
  fetch: fetch as unknown as FetchLike,
  getToken: async () => {
    const s = useApp.getState();
    // Never send a token after sign-out began (supabase-js clears its storage asynchronously).
    if (s.session === "signed_out") return null;
    if (s.authMode === "supabase") return supabaseAccessToken();
    return s.devToken;
  },
  getMockVariant: () => (__DEV__ ? useApp.getState().mockVariant : null),
  reauth,
  noReauthCodes: NO_REAUTH_CODES,
  onAuthedError,
});

export const api = endpoints(http);
export { ApiError } from "./http";
export { toUserMessage, userMessageText, UserFacingError } from "./errors";

let booting: Promise<void> | null = null;

/** GET /api/health → persisted account session (Supabase) or a dev session (local backend). */
export function boot(): Promise<void> {
  if (booting) return booting;
  booting = (async () => {
    useApp.getState().setBoot({ bootError: null });
    try {
      await loadPersisted();
      const r = await bootstrapAuth({
        health: api.health,
        supabaseConfigured: supabaseConfigured(),
        supabaseSession: supabaseStoredSession,
        supabaseSignOut,
        devSession: api.devSession,
        loadDevUserId: devUserStore.load,
        saveDevUserId: devUserStore.save,
      });
      if (r.status === "signed_in") {
        useApp.getState().setBoot({ ready: true, health: r.health, authMode: r.mode, userId: r.userId, devToken: r.devToken, session: "signed_in", authNotice: null });
      } else {
        useApp.getState().setBoot({ ready: true, health: r.health, authMode: r.mode, userId: null, devToken: null, session: "signed_out", authNotice: r.notice });
      }
    } catch (e) {
      log.handled("boot", e);
      useApp.getState().setBoot({ ready: false, bootError: toUserMessage(e).message });
      booting = null;
    }
  })();
  return booting;
}

/** Email + password sign-in (Supabase). Throws errors meant for toUserMessage. */
export async function signIn(email: string, password: string): Promise<void> {
  const s = await supabasePasswordSignIn(email.trim().toLowerCase(), password);
  if (isLegacyAnonymous(s)) {
    await supabaseSignOut();
    throw new UserFacingError("Sign in with the email and password of your account.", "Couldn't sign in", false);
  }
  queryClient.clear();
  // Onboarding (permissions + profile) is per account: a different account on this phone gets it.
  try {
    if ((await lastAccountStore.load()) !== s.userId) {
      useApp.getState().setOnboarded(false);
      await lastAccountStore.save(s.userId);
    }
  } catch (e) {
    log.handled("last-account", e);
  }
  useApp.getState().setBoot({ authMode: "supabase", userId: s.userId, devToken: null, session: "signed_in", authNotice: null, suspended: false });
}

/**
 * Create the account on our server (confirmed immediately, no email), then sign in. A fresh
 * account goes through onboarding (permissions + profile) next.
 */
export async function signUp(body: Parameters<typeof api.signup>[0]): Promise<void> {
  await api.signup(body);
  useApp.getState().setOnboarded(false);
  await signIn(body.email, body.password);
}

/** Sign out on this phone and show Welcome. Clears every cached server response. */
export async function endSession(notice: AuthNotice | null): Promise<void> {
  const s = useApp.getState();
  // Flip to signed-out FIRST (synchronously): the app unmounts now, and 401s from requests still in
  // flight while the token is revoked are ignored (onAuthedError acts only while signed in), so
  // they can't fire a second endSession that overwrites this notice.
  useApp.setState({ lastSeenBalanceCents: null });
  s.setBoot({ session: "signed_out", authNotice: notice, userId: null, devToken: null, suspended: false });
  queryClient.clear();
  if (s.authMode === "supabase") await supabaseSignOut();
  queryClient.clear();
}

export const signOut = (): Promise<void> => endSession(null);

/** Local dev backend only: Welcome's "continue" re-runs boot, which issues a fresh dev session. */
export function devContinue(): Promise<void> {
  booting = null;
  return boot();
}
