"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Referenced literally so Next inlines them into the client bundle.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = (): boolean => URL.length > 0 && ANON.length > 0;

let client: SupabaseClient | null | undefined;

/** Browser Supabase client (auth + realtime), or null in local mode / when env is not set. */
export function getBrowserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  client = supabaseConfigured() && typeof window !== "undefined" ? createBrowserClient(URL, ANON) : null;
  return client;
}
