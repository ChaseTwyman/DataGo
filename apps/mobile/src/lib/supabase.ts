import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
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

/** Anonymous contributor sign-in, reusing a persisted session when one exists. */
export async function supabaseAnonymousSignIn(): Promise<{ userId: string; token: string }> {
  const sb = getSupabase();
  const existing = (await sb.auth.getSession()).data.session;
  if (existing) return { userId: existing.user.id, token: existing.access_token };
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.session) throw new Error(`Anonymous sign-in failed: ${error?.message ?? "no session"}`);
  return { userId: data.session.user.id, token: data.session.access_token };
}

export async function supabaseAccessToken(): Promise<string | null> {
  if (!client) return null;
  return (await client.auth.getSession()).data.session?.access_token ?? null;
}
