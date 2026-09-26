"use client";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { api } from "./api";
import { clearSession, writeSession, type StoredSession } from "./session";

/** Local backend: mint a dev bearer token for a demo researcher. */
export async function signInLocalResearcher(): Promise<StoredSession> {
  const r = await api.devSession("researcher");
  const s: StoredSession = { mode: "local", access_token: r.access_token, user_id: r.user_id, role: r.role, email: null };
  writeSession(s);
  return s;
}

export async function signInWithPassword(email: string, password: string): Promise<StoredSession> {
  const sb = getBrowserSupabase();
  if (!sb) throw new Error("Supabase is not configured in this browser build (NEXT_PUBLIC_SUPABASE_URL).");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? "Sign-in failed");
  // Role is enforced server-side per route; the dashboard is researcher-only, so assume it here.
  const s: StoredSession = {
    mode: "supabase",
    access_token: data.session.access_token,
    user_id: data.session.user.id,
    role: "researcher",
    email: data.session.user.email ?? email,
  };
  writeSession(s);
  return s;
}

export async function signOut(): Promise<void> {
  const sb = getBrowserSupabase();
  if (sb) await sb.auth.signOut().catch(() => undefined);
  clearSession();
}
