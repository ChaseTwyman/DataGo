/**
 * Account credentials behind one interface, so routes never talk to Supabase Auth directly and tests
 * can swap in a fake.
 *
 * - Supabase: the admin API creates users already confirmed (`email_confirm: true`), so no email is
 *   ever sent; the current password is verified with a password grant against the anon endpoint.
 * - LOCAL_BACKEND=1: the PGlite `auth.users` table, bcrypt via pgcrypto (same crypt() GoTrue uses).
 */
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
}

const g = globalThis as typeof globalThis & { __gtAccountAuth?: AccountAuth | null };

export function getAccountAuth(): AccountAuth {
  if (g.__gtAccountAuth) return g.__gtAccountAuth;
  return isLocalBackend() ? new LocalAccountAuth() : new SupabaseAccountAuth();
}

export function setAccountAuthForTests(a: AccountAuth | null): void {
  g.__gtAccountAuth = a;
}
