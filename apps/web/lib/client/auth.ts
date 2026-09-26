"use client";
import { RoleSchema } from "@groundtruth/shared";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { FriendlyError } from "./errors";
import { api } from "./api";
import { clearSession, writeSession, type StoredSession } from "./session";

/** Local backend: mint a dev bearer token for a demo researcher. */
export async function signInLocalResearcher(): Promise<StoredSession> {
  const r = await api.devSession("researcher");
  const s: StoredSession = { mode: "local", access_token: r.access_token, user_id: r.user_id, role: RoleSchema.catch("researcher").parse(r.role), email: null };
  writeSession(s);
  return s;
}

export async function signInWithPassword(email: string, password: string): Promise<StoredSession> {
  const sb = getBrowserSupabase();
  if (!sb) throw new FriendlyError("Password sign-in isn't available on this deployment.");
  let result: Awaited<ReturnType<typeof sb.auth.signInWithPassword>>;
  try {
    result = await sb.auth.signInWithPassword({ email, password });
  } catch {
    throw new FriendlyError("Can't reach the sign-in service. Check your connection and try again.");
  }
  const { data, error } = result;
  if (error || !data.session) {
    const bad = error && (error.status === 400 || /invalid login credentials/i.test(error.message));
    throw new FriendlyError(bad ? "That email and password don't match. Try again." : "Sign-in didn't work just now. Try again in a moment.");
  }
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
