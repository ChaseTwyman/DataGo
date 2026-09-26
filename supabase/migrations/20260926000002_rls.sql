-- Row level security.
-- Contributors: read active bounties, own sessions / submissions / ledger.
-- Researchers: read everything for bounties they own. Admins: read everything.
-- The API and pipeline use the service role, which bypasses RLS; clients mostly read.

create or replace function public.current_role_is(roles public.user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = any (roles));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_is(array['admin']::public.user_role[]);
$$;

create or replace function public.is_researcher() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_is(array['researcher', 'admin']::public.user_role[]);
$$;

create or replace function public.owns_bounty(p_bounty uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.bounties b where b.id = p_bounty and b.created_by = auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.protocols enable row level security;
alter table public.bounties enable row level security;
alter table public.capture_sessions enable row level security;
alter table public.submissions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.weather_alerts enable row level security;
alter table public.match_cache enable row level security;
alter table public.synthetic_media enable row level security;
alter table public.redteam_runs enable row level security;

-- profiles: own row; researchers can read contributor profiles (display name, trust) for review.
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_researcher());

-- protocols: published ones are public to signed-in users; researchers see drafts they made.
create policy protocols_select on public.protocols
  for select to authenticated
  using (status = 'published' or created_by = auth.uid() or public.is_admin());
create policy protocols_write on public.protocols
  for insert to authenticated with check (public.is_researcher() and created_by = auth.uid());
create policy protocols_update on public.protocols
  for update to authenticated using (public.is_researcher() and (created_by = auth.uid() or public.is_admin()));

-- bounties
create policy bounties_select on public.bounties
  for select to authenticated
  using (status = 'active' or created_by = auth.uid() or public.is_admin());
create policy bounties_insert on public.bounties
  for insert to authenticated with check (public.is_researcher() and created_by = auth.uid());
create policy bounties_update on public.bounties
  for update to authenticated using (public.owns_bounty(id));

-- capture sessions
create policy sessions_select on public.capture_sessions
  for select to authenticated using (user_id = auth.uid() or public.owns_bounty(bounty_id));

-- submissions
create policy submissions_select on public.submissions
  for select to authenticated using (user_id = auth.uid() or public.owns_bounty(bounty_id));

-- ledger
create policy ledger_select on public.ledger_entries
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- weather alerts: public information
create policy weather_select on public.weather_alerts for select to authenticated using (true);

-- match cache: own
create policy match_select on public.match_cache for select to authenticated using (user_id = auth.uid());

-- synthetic media: labeled examples are readable by the app
create policy synthetic_select on public.synthetic_media for select to authenticated using (true);

-- red team: researchers on their bounties
create policy redteam_select on public.redteam_runs
  for select to authenticated using (public.owns_bounty(bounty_id));
