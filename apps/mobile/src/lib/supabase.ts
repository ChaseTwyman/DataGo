import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { mapSupabaseAuthError, type StoredSession } from "../api/authFlow";
import { ENV } from "./env";

/** SecureStore-backed auth storage (Keychain on iOS). */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

let client: SupabaseClient | null = null;

export const supabaseConfigured = (): boolean => !!ENV.supabaseUrl && !!ENV.supabaseAnonKey;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!supabaseConfigured()) throw new Error("Supabase is not configured (EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY)");
    client = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
  }
  return client;
}

/**
 * The persisted session, if any. No network sign-in: accounts are required, so there is no
 * anonymous fallback (the API refuses anonymous users with ACCOUNT_REQUIRED).
 */
export async function supabaseStoredSession(): Promise<StoredSession | null> {
  const s = (await getSupabase().auth.getSession()).data.session;
  if (!s) return null;
  return { userId: s.user.id, email: s.user.email ?? null, isAnonymous: s.user.is_anonymous === true };
}

/** Email + password sign-in. Throws an ApiError (mapped codes) on failure. */
export async function supabasePasswordSignIn(email: string, password: string): Promise<StoredSession> {
  let res: Awaited<ReturnType<SupabaseClient["auth"]["signInWithPassword"]>>;
  try {
    res = await getSupabase().auth.signInWithPassword({ email, password });
  } catch (e) {
    throw mapSupabaseAuthError(e);
  }
  if (res.error || !res.data.session) throw mapSupabaseAuthError(res.error);
  const u = res.data.session.user;
  return { userId: u.id, email: u.email ?? null, isAnonymous: u.is_anonymous === true };
}

/** Clears the session on this phone. Never throws (offline sign-out still signs out locally). */
export async function supabaseSignOut(): Promise<void> {
  if (!supabaseConfigured()) return;
  try {
    await getSupabase().auth.signOut({ scope: "local" });
  } catch {
    // Local storage is cleared by supabase-js before the network call; nothing else to do.
  }
}

export async function supabaseAccessToken(): Promise<string | null> {
  if (!client) return null;
  return (await client.auth.getSession()).data.session?.access_token ?? null;
}
