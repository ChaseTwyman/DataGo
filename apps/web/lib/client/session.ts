"use client";
/**
 * Client-side session storage. Local mode stores the dev bearer token from POST /api/dev/session;
 * Supabase mode lets supabase-js own (and refresh) the session and we only remember the mode.
 */
import type { Role } from "@groundtruth/shared";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const KEY = "groundtruth.session.v1";

export interface StoredSession {
  mode: "local" | "supabase";
  access_token: string;
  user_id: string;
  role: Role;
  email: string | null;
}

export function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (!v || typeof v.access_token !== "string" || (v.mode !== "local" && v.mode !== "supabase")) return null;
    return v as StoredSession;
  } catch {
    return null;
  }
}

export function writeSession(s: StoredSession): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: session lasts for this page only */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Current bearer token. Supabase sessions are read from supabase-js so refreshed tokens are used. */
export async function getAccessToken(): Promise<string | null> {
  const s = readSession();
  if (!s) return null;
  if (s.mode === "supabase") {
    const sb = getBrowserSupabase();
    if (sb) {
      const { data } = await sb.auth.getSession();
      return data.session?.access_token ?? null;
    }
  }
  return s.access_token;
}
