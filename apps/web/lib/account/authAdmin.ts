/**
 * Account credentials behind one interface, so routes never talk to Supabase Auth directly and tests
 * can swap in a fake.
 *
 * - Supabase: the admin API creates users already confirmed (`email_confirm: true`), so no sign-up
 *   email is sent; the current password is verified with a password grant against the anon endpoint.
 *   Forgot password uses GoTrue's recovery email (code + link) through the project's custom SMTP.
 * - LOCAL_BACKEND=1: the PGlite `auth.users` table, bcrypt via pgcrypto (same crypt() GoTrue uses);
 *   recovery codes are kept in memory and printed to the dev console instead of emailed.
 */
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "../db";
import { getDb } from "../db";
import { isLocalBackend } from "../env";
import { supabaseAdmin } from "../supabase/admin";

export class EmailTakenError extends Error {
  constructor() {
    super("email already registered");
    this.name = "EmailTakenError";
  }
}

export interface AccountAuth {
  /** Creates a confirmed email+password user. Throws EmailTakenError on a duplicate. */
  createUser(email: string, password: string, displayName: string): Promise<{ id: string }>;
  /** True when the password is the user's current one. */
  verifyPassword(email: string, password: string): Promise<boolean>;
  setPassword(userId: string, password: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /** LOCAL only: resolves a user id for email+password (dev sign-in). */
  signInLocal?(email: string, password: string): Promise<string | null>;

  /**
   * Forgot password: sends the recovery email (code + link) if the email has an account; silently
   * does nothing otherwise. Callers must not reveal the outcome to the requester.
   */
  requestPasswordReset(email: string, redirectTo: string | undefined): Promise<void>;
  /**
   * Redeems a recovery code (with its email) or a link token_hash. One-time: a redeemed code is
   * gone. null = wrong, expired or already used. Throws RecoveryRateLimitedError when the auth
   * server throttles verification.
   */
  verifyRecovery(input: RecoveryProof): Promise<RecoveredUser | null>;
  /** Ends every session of the user (all devices), including the recovery session itself. */
  revokeSessions(user: RecoveredUser): Promise<void>;
}

export type RecoveryProof = { email: string; code: string } | { tokenHash: string };
export interface RecoveredUser {
  id: string;
  email: string | null;
  /** The recovery session's access token (Supabase), used to revoke all sessions. */
  accessToken: string | null;
}

export class RecoveryRateLimitedError extends Error {
  constructor() {
    super("recovery verification rate limited");
    this.name = "RecoveryRateLimitedError";
  }
}

function supabasePublicEnv(): { url: string; anon: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
  return { url: url.replace(/\/+$/, ""), anon };
}

export class SupabaseAccountAuth implements AccountAuth {
  async createUser(email: string, password: string, displayName: string): Promise<{ id: string }> {
    const { data, error } = await supabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error || !data.user) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|already exists/i.test(error?.message ?? "")) {
        throw new EmailTakenError();
      }
      throw new Error(`createUser failed: ${code ?? error?.status ?? "no user"}`);
    }
    return { id: data.user.id };
  }

  async verifyPassword(email: string, password: string): Promise<boolean> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 400 || res.status === 401) return false;
    if (!res.ok) throw new Error(`password grant failed: ${res.status}`);
    // Revoke the throwaway session the check created (best effort).
    try {
      const body = (await res.json()) as { access_token?: string };
      if (body.access_token) {
        await fetch(`${url}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: anon, authorization: `Bearer ${body.access_token}` } });
      }
    } catch {
      /* ignore */
    }
    return true;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(`updateUserById failed: ${error.status ?? ""}`);
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await supabaseAdmin().auth.admin.deleteUser(userId);
    if (error && error.status !== 404) throw new Error(`deleteUser failed: ${error.status ?? ""}`);
  }

  // Recovery uses GoTrue's REST endpoints with the anon key rather than supabase-js: verifyOtp on
  // the shared service-role client would store the user's session in it, and every later Storage
  // call from that client would then run as that user instead of the service role.

  async requestPasswordReset(email: string, redirectTo: string | undefined): Promise<void> {
    const { url, anon } = supabasePublicEnv();
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
    const res = await fetch(`${url}/auth/v1/recover${q}`, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    // GoTrue answers 200 for unknown emails too. Failures (SMTP, its own 429) are the caller's to log.
    if (!res.ok) throw new Error(`recover failed: ${res.status}`);
  }

  async verifyRecovery(input: RecoveryProof): Promise<RecoveredUser | null> {
    const { url, anon } = supabasePublicEnv();
    const body = "tokenHash" in input ? { type: "recovery", token_hash: input.tokenHash } : { type: "recovery", email: input.email, token: input.code };
    const res = await fetch(`${url}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) throw new RecoveryRateLimitedError();
    // 400/401/403/404/410/422: wrong, expired (otp_expired) or already used.
    if (res.status >= 400 && res.status < 500) return null;
    if (!res.ok) throw new Error(`verify failed: ${res.status}`);
    const s = (await res.json()) as { access_token?: string; user?: { id?: string; email?: string | null } };
    if (!s.user?.id) return null;
    return { id: s.user.id, email: s.user.email ?? null, accessToken: s.access_token ?? null };
  }

  async revokeSessions(user: RecoveredUser): Promise<void> {
    if (!user.accessToken) throw new Error("no recovery session to revoke with");
    const { url, anon } = supabasePublicEnv();
    // scope=global revokes every refresh token of the user (all devices), this session included.
    const res = await fetch(`${url}/auth/v1/logout?scope=global`, { method: "POST", headers: { apikey: anon, authorization: `Bearer ${user.accessToken}` } });
    if (!res.ok && res.status !== 404) throw new Error(`global logout failed: ${res.status}`);
  }
}

/** LOCAL_BACKEND recovery codes live in memory (one dev server process; PGlite is single-process too). */
interface LocalCode {
  userId: string;
  email: string;
  code: string;
  tokenHash: string;
  expiresAt: number;
}
const gl = globalThis as typeof globalThis & { __gtLocalResetCodes?: Map<string, LocalCode> };
const localCodes = (gl.__gtLocalResetCodes ??= new Map());
const LOCAL_CODE_TTL_MS = 60 * 60 * 1000;

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class LocalAccountAuth implements AccountAuth {
  constructor(private readonly db: () => Promise<Db> = getDb) {}

  async createUser(email: string, password: string): Promise<{ id: string }> {
    const db = await this.db();
    const taken = await db.query("select 1 from auth.users where lower(email) = lower($1)", [email]);
    if (taken.length > 0) throw new EmailTakenError();
    const rows = await db.query<{ id: string }>(
      `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, is_anonymous, created_at, updated_at)
       values (gen_random_uuid(), 'authenticated', 'authenticated', $1, extensions.crypt($2, extensions.gen_salt('bf')), now(), false, now(), now())
       returning id`,
      [email, password],
    );
    return { id: rows[0]!.id };
  }

  async verifyPassword(email: string, password: string): Promise<boolean> {
    return (await this.signInLocal(email, password)) !== null;
  }

  async signInLocal(email: string, password: string): Promise<string | null> {
    const db = await this.db();
    const rows = await db.query<{ id: string }>(
      `select id from auth.users
        where lower(email) = lower($1) and encrypted_password is not null
          and encrypted_password = extensions.crypt($2, encrypted_password)`,
      [email, password],
    );
    return rows[0]?.id ?? null;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const db = await this.db();
    await db.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), updated_at = now() where id = $1", [
      userId,
      password,
    ]);
  }

  async deleteUser(userId: string): Promise<void> {
    const db = await this.db();
    await db.query("delete from auth.users where id = $1", [userId]);
  }

  /** No email in local mode: the code and link are printed to the dev server console (never in production). */
  async requestPasswordReset(email: string, redirectTo: string | undefined): Promise<void> {
    const db = await this.db();
    const rows = await db.query<{ id: string; email: string }>("select id, email from auth.users where lower(email) = lower($1) and is_anonymous is not true", [email]);
    const u = rows[0];
    if (!u) return;
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const tokenHash = randomBytes(24).toString("hex");
    localCodes.set(u.email.toLowerCase(), { userId: u.id, email: u.email, code, tokenHash, expiresAt: Date.now() + LOCAL_CODE_TTL_MS });
    if (process.env.NODE_ENV !== "production") {
      const link = `${redirectTo ?? "/reset-password"}?token_hash=${tokenHash}&type=recovery`;
      console.info(`[password-reset] LOCAL_BACKEND dev only: code for ${u.email} is ${code} (link: ${link})`);
    }
  }

  async verifyRecovery(input: RecoveryProof): Promise<RecoveredUser | null> {
    const now = Date.now();
    for (const [key, c] of localCodes) {
      const match = "tokenHash" in input ? sameSecret(c.tokenHash, input.tokenHash) : key === input.email.toLowerCase() && sameSecret(c.code, input.code);
      if (!match) continue;
      localCodes.delete(key); // one-time
      return c.expiresAt > now ? { id: c.userId, email: c.email, accessToken: null } : null;
    }
    return null;
  }

  /** Dev bearer tokens are stateless (`dev.<uuid>`), so there is nothing to revoke locally. */
  async revokeSessions(): Promise<void> {}
}

const g = globalThis as typeof globalThis & { __gtAccountAuth?: AccountAuth | null };

export function getAccountAuth(): AccountAuth {
  if (g.__gtAccountAuth) return g.__gtAccountAuth;
  return isLocalBackend() ? new LocalAccountAuth() : new SupabaseAccountAuth();
}

export function setAccountAuthForTests(a: AccountAuth | null): void {
  g.__gtAccountAuth = a;
}
