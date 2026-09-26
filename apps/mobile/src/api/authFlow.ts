/**
 * Startup auth decision, pure (deps injected, unit-tested):
 * - health.backend === "supabase" and a Supabase URL is configured → anonymous Supabase sign-in.
 * - otherwise → POST /api/dev/session, reusing the persisted dev user id.
 */
import type { HealthResponse } from "@groundtruth/shared";

export interface AuthDeps {
  health: () => Promise<HealthResponse>;
  supabaseConfigured: boolean;
  supabaseSignIn: () => Promise<{ userId: string; token: string }>;
  devSession: (userId?: string) => Promise<{ user_id: string; access_token: string }>;
  loadDevUserId: () => Promise<string | null>;
  saveDevUserId: (id: string) => Promise<void>;
}

export interface AuthResult {
  health: HealthResponse;
  mode: "supabase" | "dev";
  userId: string;
  /** Static token (dev). Supabase tokens are read fresh from the client on every call. */
  devToken: string | null;
}

export async function bootstrapAuth(d: AuthDeps): Promise<AuthResult> {
  const health = await d.health();
  if (health.backend === "supabase" && d.supabaseConfigured) {
    const s = await d.supabaseSignIn();
    return { health, mode: "supabase", userId: s.userId, devToken: null };
  }
  const saved = await d.loadDevUserId();
  let session: { user_id: string; access_token: string };
  try {
    session = await d.devSession(saved ?? undefined);
  } catch (e) {
    // A reset local DB forgets the user; start fresh rather than locking the app out.
    if (!saved) throw e;
    session = await d.devSession(undefined);
  }
  if (session.user_id !== saved) await d.saveDevUserId(session.user_id);
  return { health, mode: "dev", userId: session.user_id, devToken: session.access_token };
}
