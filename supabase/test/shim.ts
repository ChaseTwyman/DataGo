/**
 * Stand-in for the Supabase-managed schemas (auth, storage, roles) so the real migrations + seed can
 * be applied to PGlite (in-process Postgres). Shared by the migration tests and the web app's
 * LOCAL_BACKEND=1 mode (apps/web/lib/db/pglite.ts). Keep this file free of imports.
 */

export const SUPABASE_SHIM_SQL = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, confirmation_token text, email_change text,
  email_change_token_new text, recovery_token text, is_anonymous boolean default false
);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users(id), provider_id text, identity_data jsonb,
  provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  unique (provider_id, provider)
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

export const SUPABASE_GRANTS_SQL = `
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public, auth, storage to anon, authenticated, service_role;
`;

/** Minimal executor interface (PGlite's `exec`). */
export interface SqlExec {
  exec(sql: string): Promise<unknown>;
}

/**
 * Applies shim → migrations (in filename order) → seed → grants. `files` supplies the SQL text so
 * this module stays free of fs imports (callers read `supabase/migrations/*.sql` and `seed.sql`).
 */
export async function applySupabaseSchema(
  db: SqlExec,
  files: { migrations: string[]; seed: string | null },
): Promise<void> {
  await db.exec(SUPABASE_SHIM_SQL);
  for (const sql of files.migrations) await db.exec(sql);
  if (files.seed) await db.exec(files.seed);
  await db.exec(SUPABASE_GRANTS_SQL);
}
