-- Accounts, roles as flags, suspension, data rights, retention, rate limits. Additive + idempotent.
--
-- Product decision (2026-09-26): everyone has an email+password account; one account can be both a
-- contributor and a researcher. Researcher is self-serve (organization + purpose + terms); admins can
-- revoke. Authorization now reads boolean flags instead of the single `role` enum, because a single
-- enum can't express "contributor AND researcher" or "admin who also runs bounties".
--
-- `profiles.role` stays for compatibility (old app builds, old SQL) and is kept in sync by a trigger:
--   flags changed  → role derived from flags (admin > researcher > contributor)
--   only role changed (old code / old seed) → flags derived from role
--
-- 1. profile flags + researcher profile + suspension (+ researcher_revoked_at so an admin revoke
--    can't be undone by the user re-enabling self-serve)
-- 2. role <-> flag sync trigger and backfill from the enum
-- 3. SQL auth helpers read flags; suspended and anonymous users get nothing (restrictive policies)
-- 4. deleted-user placeholder that de-identified open-data rows are reassigned to on account deletion
-- 5. submissions.media_purged_at (rejected-photo retention job)
-- 6. rate_limits (DB-backed fixed windows; works on serverless)

-- ---------------------------------------------------------------- 1. columns
alter table public.profiles
  add column if not exists is_researcher boolean not null default false,
  add column if not exists is_admin boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists researcher_org text,
  add column if not exists researcher_purpose text,
  add column if not exists researcher_since timestamptz,
  add column if not exists researcher_revoked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_researcher_org_len') then
    alter table public.profiles add constraint profiles_researcher_org_len
      check (researcher_org is null or char_length(researcher_org) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_researcher_purpose_len') then
    alter table public.profiles add constraint profiles_researcher_purpose_len
      check (researcher_purpose is null or char_length(researcher_purpose) <= 1000);
  end if;
end $$;

-- ---------------------------------------------------------------- 2. sync + backfill
create or replace function public.sync_profile_role() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and new.is_researcher is not distinct from old.is_researcher
     and new.is_admin is not distinct from old.is_admin then
    -- legacy writer changed only the enum: follow it
    new.is_admin := new.role = 'admin';
    new.is_researcher := new.role in ('researcher', 'admin');
    if new.is_researcher and new.researcher_since is null then new.researcher_since := now(); end if;
  else
    new.role := case when new.is_admin then 'admin'
                     when new.is_researcher then 'researcher'
                     else 'contributor' end::public.user_role;
  end if;
  return new;
end $$;

drop trigger if exists profiles_sync_role on public.profiles;
create trigger profiles_sync_role
  before insert or update on public.profiles
  for each row execute function public.sync_profile_role();

-- Backfill (idempotent): only rows whose flags don't match their enum yet. Updating the flags fires
-- the trigger's flags branch, which re-derives the same role.
update public.profiles
   set is_admin = (role = 'admin'),
       is_researcher = (role in ('researcher', 'admin')),
       researcher_since = coalesce(researcher_since, case when role in ('researcher', 'admin') then created_at end)
 where is_admin is distinct from (role = 'admin')
    or is_researcher is distinct from (role in ('researcher', 'admin'));

-- ---------------------------------------------------------------- 3. auth helpers on flags
-- Active = has a profile, not suspended, not an anonymous Supabase user.
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
      join auth.users u on u.id = p.id
     where p.id = auth.uid() and p.suspended_at is null and coalesce(u.is_anonymous, false) = false
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
$$;

create or replace function public.is_researcher() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_researcher);
$$;

-- Kept for compatibility; now answers from the flags (role derived admin > researcher > contributor).
create or replace function public.current_role_is(roles public.user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (case when p.is_admin then 'admin' when p.is_researcher then 'researcher' else 'contributor' end)::public.user_role = any (roles)
  );
$$;

-- owns_bounty: admins, or a researcher (flag) who created the bounty. Previously any creator.
create or replace function public.owns_bounty(p_bounty uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_researcher() and exists (select 1 from public.bounties b where b.id = p_bounty and b.created_by = auth.uid()));
$$;

-- Suspended / anonymous users see nothing: one RESTRICTIVE policy per table ANDs with the existing
-- permissive ones, so the existing policies need no rewrite.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'protocols', 'bounties', 'capture_sessions', 'submissions', 'ledger_entries',
                           'weather_alerts', 'match_cache', 'synthetic_media', 'redteam_runs'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_active_only') then
      execute format('create policy %I on public.%I as restrictive for all to authenticated using (public.is_active_user())',
                     t || '_active_only', t);
    end if;
  end loop;
end $$;

-- Storage: own-folder reads also require an active account (researcher reads go through is_researcher()).
drop policy if exists observations_owner_read on storage.objects;
create policy observations_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'observations' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());

-- Nobody can change their own flags through the REST API: profiles has no UPDATE policy, so RLS
-- refuses every client write (tested). A column-level REVOKE would not help: it is ignored while the
-- table-level UPDATE grant Supabase gives `authenticated` exists. Only the API's own connection writes.

-- ---------------------------------------------------------------- 4. deleted-user placeholder
-- Accepted, publishable observations of a deleted account stay in the open dataset (released under
-- CC BY 4.0) but are reassigned here. No email, no password, no identity: nobody can sign in as it.
-- Token columns are '' not NULL: GoTrue's admin user listing fails on NULL token columns.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000dead', 'authenticated', 'authenticated',
  null, null, null, '{}'::jsonb, '{"display_name":"Deleted user"}'::jsonb, now(), now(), '', '', '', ''
) on conflict (id) do nothing;

insert into public.profiles (id, display_name, suspended_at)
values ('00000000-0000-4000-8000-00000000dead', 'Deleted user', now())
on conflict (id) do update set display_name = 'Deleted user', suspended_at = coalesce(public.profiles.suspended_at, now()),
  is_admin = false, is_researcher = false;

-- ---------------------------------------------------------------- 5. retention marker
alter table public.submissions add column if not exists media_purged_at timestamptz;
create index if not exists submissions_retention_idx on public.submissions (status, received_at)
  where media_purged_at is null;

-- ---------------------------------------------------------------- 6. rate limits
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Atomic hit: returns the count in the current window after this hit.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer) returns integer
language sql security definer set search_path = public as $$
  insert into public.rate_limits (key, window_start, count)
  values (p_key, to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds), 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count;
$$;
revoke execute on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
