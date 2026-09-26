-- Sponsor pool + platform pricing. Additive + idempotent.
--
-- Product decision (2026-09-26): researchers no longer fund bounties. Sponsors contribute (simulated)
-- money to a pool; researchers submit data REQUESTS (protocol, area, window, target per cell,
-- justification); the platform's allocation engine funds requests from the pool (earmarks first, then
-- the general pool) and the platform's pricing engine sets every price. `bounties.budget_cents` is
-- reused as the request's ALLOCATION and is kept equal to the sum of its pool_allocations rows.
--
-- 1. bounty_status 'pending_funding' + request columns (justification, funding_reason, funded_at)
-- 2. sponsors (mutable profile), sponsor_contributions + pool_allocations (append-only ledgers;
--    corrections are reversing entries, UPDATE/DELETE raise)
-- 3. pool functions (server-only: refuse any caller with a JWT subject, and EXECUTE is revoked from
--    anon/authenticated): bucket availability, atomic allocate/release, contribution reversal,
--    external funding (legacy/demo budgets recorded as earmarked contributions)
-- 4. backfill: every existing bounty with a budget becomes "already funded" by an earmarked
--    contribution of exactly its budget, so pool totals stay consistent with bounty budgets
-- 5. views: pool_buckets (per earmark + general) for the admin/public dashboards
-- 6. spend_bounty_budget gets the same server-only guard (it was callable by any signed-in user
--    through PostgREST RPC, which let anyone exhaust any bounty's budget)
--
-- NOTE: 'pending_funding' is added with ALTER TYPE ... ADD VALUE, which can't be USED in the same
-- transaction; nothing below compares against it except plpgsql bodies (evaluated at call time).

-- ---------------------------------------------------------------- 1. requests
alter type public.bounty_status add value if not exists 'pending_funding';

alter table public.bounties
  add column if not exists justification text,
  add column if not exists funding_reason text,
  add column if not exists funded_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bounties_justification_len') then
    alter table public.bounties add constraint bounties_justification_len
      check (justification is null or char_length(justification) <= 1000);
  end if;
end $$;

-- Existing funded bounties are "already funded" from their creation time.
update public.bounties set funded_at = created_at where funded_at is null and budget_cents > 0;

-- ---------------------------------------------------------------- 2. sponsors + ledgers
create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  url text check (url is null or char_length(url) <= 300),
  logo_url text check (logo_url is null or char_length(logo_url) <= 300),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sponsors_name_key on public.sponsors (lower(btrim(name)));

-- One row per contribution (kind 'contribution') or correction (kind 'reversal', which points at the
-- contribution it reduces). Amounts are always positive; a reversal's effect is negative.
-- Earmarks (any combination; none = general pool): protocol slug, region (center + radius and/or a
-- polygon, matched against the request's center), or one specific request (bounty_id).
-- created_by is a plain uuid (no FK) so deleting an admin's account never rewrites the audit trail.
create table if not exists public.sponsor_contributions (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.sponsors (id) on delete restrict,
  kind text not null default 'contribution' check (kind in ('contribution', 'reversal')),
  amount_cents integer not null check (amount_cents > 0),
  reverses_id uuid references public.sponsor_contributions (id) on delete restrict,
  protocol_slug text check (protocol_slug is null or char_length(protocol_slug) <= 120),
  region_center_lat double precision check (region_center_lat is null or region_center_lat between -90 and 90),
  region_center_lng double precision check (region_center_lng is null or region_center_lng between -180 and 180),
  region_radius_m double precision check (region_radius_m is null or region_radius_m > 0),
  region_polygon jsonb,
  bounty_id uuid references public.bounties (id) on delete restrict,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'reversal') = (reverses_id is not null)),
  check (kind = 'contribution' or (protocol_slug is null and bounty_id is null and region_center_lat is null and region_polygon is null)),
  check ((region_center_lat is null) = (region_center_lng is null) and (region_center_lat is null) = (region_radius_m is null))
);
create index if not exists sponsor_contributions_sponsor_idx on public.sponsor_contributions (sponsor_id, created_at desc);
create index if not exists sponsor_contributions_reverses_idx on public.sponsor_contributions (reverses_id);

-- Money moving between a pool bucket and a request. Positive = allocated to the request, negative =
-- released back to the bucket. contribution_id null = the general pool; otherwise the earmarked
-- contribution the money came from.
create table if not exists public.pool_allocations (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.bounties (id) on delete restrict,
  contribution_id uuid references public.sponsor_contributions (id) on delete restrict,
  amount_cents integer not null check (amount_cents <> 0),
  kind text not null check (kind in ('allocate', 'adjust', 'release', 'migrated')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists pool_allocations_bounty_idx on public.pool_allocations (bounty_id, created_at);
create index if not exists pool_allocations_contribution_idx on public.pool_allocations (contribution_id);

create or replace function public.pool_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'APPEND_ONLY: % rows are never changed or deleted; record a reversing entry', tg_table_name
    using errcode = 'P0001';
end $$;

drop trigger if exists sponsor_contributions_append_only on public.sponsor_contributions;
create trigger sponsor_contributions_append_only
  before update or delete on public.sponsor_contributions
  for each row execute function public.pool_append_only();
drop trigger if exists pool_allocations_append_only on public.pool_allocations;
create trigger pool_allocations_append_only
  before update or delete on public.pool_allocations
  for each row execute function public.pool_append_only();

-- Only the API's own connection reads or writes these (RLS on, no policies; grants revoked).
alter table public.sponsors enable row level security;
alter table public.sponsor_contributions enable row level security;
alter table public.pool_allocations enable row level security;
revoke all on public.sponsors, public.sponsor_contributions, public.pool_allocations from anon, authenticated;

-- ---------------------------------------------------------------- 3. functions
-- Every function below refuses callers that carry a Supabase JWT subject (PostgREST RPC); the API
-- connects directly and has none. EXECUTE is revoked too (defence in depth).
create or replace function public.pool_assert_server() returns void
language plpgsql stable as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
              nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub') is not null then
    raise exception 'SERVER_ONLY: pool and budget functions are not callable by users' using errcode = '42501';
  end if;
end $$;

create or replace function public.pool_is_earmarked(c public.sponsor_contributions) returns boolean
language sql immutable as $$
  select c.protocol_slug is not null or c.bounty_id is not null or c.region_center_lat is not null or c.region_polygon is not null
$$;

-- Contributed (net of reversals) minus net allocations for one bucket. null = general pool.
create or replace function public.pool_bucket_available(p_contribution uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare contributed bigint; allocated bigint;
begin
  if p_contribution is null then
    select coalesce(sum(case when c.kind = 'contribution' then c.amount_cents else -c.amount_cents end), 0)
      into contributed
      from public.sponsor_contributions c
      join public.sponsor_contributions o on o.id = coalesce(c.reverses_id, c.id)
     where not public.pool_is_earmarked(o);
    select coalesce(sum(a.amount_cents), 0) into allocated from public.pool_allocations a where a.contribution_id is null;
  else
    select coalesce(sum(case when c.kind = 'contribution' then c.amount_cents else -c.amount_cents end), 0)
      into contributed
      from public.sponsor_contributions c
     where c.id = p_contribution or c.reverses_id = p_contribution;
    select coalesce(sum(a.amount_cents), 0) into allocated from public.pool_allocations a where a.contribution_id = p_contribution;
  end if;
  return contributed - allocated;
end $$;

-- Atomically moves p_amount between a bucket and a request and keeps bounties.budget_cents equal to
-- the request's net allocation. Positive: the bucket must have that much available. Negative
-- (release): the request must hold that much from this bucket and keep budget >= spent.
-- Returns false (changing nothing) when refused.
create or replace function public.pool_allocate(
  p_bounty uuid, p_contribution uuid, p_amount integer, p_kind text, p_reason text, p_actor uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare b record; held bigint; orig public.sponsor_contributions;
begin
  perform public.pool_assert_server();
  if p_amount is null or p_amount = 0 then return false; end if;
  -- one pool writer at a time: availability checks and inserts can't interleave
  perform pg_advisory_xact_lock(7340001);
  select id, budget_cents, spent_cents into b from public.bounties where id = p_bounty for update;
  if not found then return false; end if;
  if p_contribution is not null then
    select * into orig from public.sponsor_contributions where id = p_contribution;
    if not found or orig.kind <> 'contribution' or not public.pool_is_earmarked(orig) then return false; end if;
    if orig.bounty_id is not null and orig.bounty_id <> p_bounty then return false; end if;
  end if;
  if p_amount > 0 then
    if public.pool_bucket_available(p_contribution) < p_amount then return false; end if;
  else
    select coalesce(sum(amount_cents), 0) into held from public.pool_allocations
     where bounty_id = p_bounty and contribution_id is not distinct from p_contribution;
    if held < -p_amount then return false; end if;
    if b.budget_cents + p_amount < b.spent_cents then return false; end if;
  end if;
  insert into public.pool_allocations (bounty_id, contribution_id, amount_cents, kind, reason, created_by)
  values (p_bounty, p_contribution, p_amount, p_kind, p_reason, p_actor);
  update public.bounties set budget_cents = budget_cents + p_amount where id = p_bounty;
  return true;
end $$;

-- Correction: reverses (part of) a contribution. Refused when the bucket no longer has that much
-- unallocated money or the total reversed would exceed the original. Returns the reversal id or null.
create or replace function public.pool_reverse_contribution(p_contribution uuid, p_amount integer, p_note text, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare orig public.sponsor_contributions; reversed bigint; bucket uuid; new_id uuid;
begin
  perform public.pool_assert_server();
  if p_amount is null or p_amount <= 0 then return null; end if;
  perform pg_advisory_xact_lock(7340001);
  select * into orig from public.sponsor_contributions where id = p_contribution;
  if not found or orig.kind <> 'contribution' then return null; end if;
  select coalesce(sum(amount_cents), 0) into reversed from public.sponsor_contributions where reverses_id = p_contribution;
  if reversed + p_amount > orig.amount_cents then return null; end if;
  bucket := case when public.pool_is_earmarked(orig) then orig.id else null end;
  if public.pool_bucket_available(bucket) < p_amount then return null; end if;
  insert into public.sponsor_contributions (sponsor_id, kind, amount_cents, reverses_id, note, created_by)
  values (orig.sponsor_id, 'reversal', p_amount, orig.id, p_note, p_actor)
  returning id into new_id;
  return new_id;
end $$;

-- Records money that funded a request outside the pool (pre-pool researcher budgets, demo events):
-- a sponsor (found by name or created), a contribution earmarked to that request for the part of its
-- budget not yet backed by allocations, and a matching 'migrated' allocation. budget_cents is not
-- changed. Idempotent: returns the amount recorded (0 when already consistent).
create or replace function public.pool_record_external_funding(p_bounty uuid, p_sponsor_name text, p_sponsor_url text, p_note text)
returns integer
language plpgsql security definer set search_path = public as $$
declare b record; backed bigint; gap integer; sid uuid; cid uuid; nm text;
begin
  perform public.pool_assert_server();
  perform pg_advisory_xact_lock(7340001);
  select id, budget_cents into b from public.bounties where id = p_bounty for update;
  if not found then return 0; end if;
  select coalesce(sum(amount_cents), 0) into backed from public.pool_allocations where bounty_id = p_bounty;
  gap := b.budget_cents - backed;
  if gap <= 0 then return 0; end if;
  nm := left(coalesce(nullif(btrim(p_sponsor_name), ''), 'Pre-pool research budgets'), 120);
  select id into sid from public.sponsors where lower(btrim(name)) = lower(btrim(nm));
  if sid is null then
    insert into public.sponsors (name, url) values (nm, left(p_sponsor_url, 300)) returning id into sid;
  end if;
  insert into public.sponsor_contributions (sponsor_id, amount_cents, bounty_id, note)
  values (sid, gap, p_bounty, left(p_note, 500)) returning id into cid;
  insert into public.pool_allocations (bounty_id, contribution_id, amount_cents, kind, reason)
  values (p_bounty, cid, gap, 'migrated', left(p_note, 500));
  update public.bounties set funded_at = coalesce(funded_at, now()) where id = p_bounty;
  return gap;
end $$;

create or replace function public.pool_backfill_legacy() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  perform public.pool_assert_server();
  for r in
    select b.id, b.sponsor_name, b.sponsor_url from public.bounties b
     where b.budget_cents > coalesce((select sum(a.amount_cents) from public.pool_allocations a where a.bounty_id = b.id), 0)
     order by b.created_at
  loop
    if public.pool_record_external_funding(r.id, r.sponsor_name, r.sponsor_url, 'Migrated: budget set before the sponsor pool') > 0 then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 6. same guard on the existing budget spend
create or replace function public.spend_bounty_budget(p_bounty uuid, p_cents integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  perform public.pool_assert_server();
  update public.bounties
     set spent_cents = spent_cents + p_cents
   where id = p_bounty and spent_cents + p_cents <= budget_cents
  returning true into ok;
  return coalesce(ok, false);
end $$;

revoke execute on function public.pool_bucket_available(uuid) from public, anon, authenticated;
revoke execute on function public.pool_allocate(uuid, uuid, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.pool_reverse_contribution(uuid, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.pool_record_external_funding(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.pool_backfill_legacy() from public, anon, authenticated;
revoke execute on function public.spend_bounty_budget(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. backfill
select public.pool_backfill_legacy();

-- ---------------------------------------------------------------- 5. views
-- One row per bucket: every earmarked contribution, plus the general pool (contribution_id null).
-- paid_cents attributes each request's spend to its buckets in proportion to its net allocations
-- (floored, so per-bucket paid can undercount the exact total by a few cents).
create or replace view public.pool_buckets with (security_invoker = true) as
with orig as (
  select o.id, o.sponsor_id, public.pool_is_earmarked(o) as earmarked,
         o.amount_cents - coalesce((select sum(r.amount_cents) from public.sponsor_contributions r where r.reverses_id = o.id), 0) as net
    from public.sponsor_contributions o
   where o.kind = 'contribution'
),
buckets as (
  select case when earmarked then id end as contribution_id, sum(net)::bigint as contributed_cents
    from orig group by 1
  union all
  select null::uuid, 0::bigint where not exists (select 1 from orig where not earmarked)
),
alloc as (
  select contribution_id, bounty_id, sum(amount_cents)::bigint as net from public.pool_allocations group by 1, 2
),
btot as (select bounty_id, sum(net) as total from alloc group by 1),
paid as (
  select a.contribution_id,
         sum(case when t.total > 0 then floor(b.spent_cents::numeric * a.net / t.total) else 0 end)::bigint as paid
    from alloc a join btot t using (bounty_id) join public.bounties b on b.id = a.bounty_id
   group by 1
)
select k.contribution_id,
       k.contributed_cents,
       coalesce((select sum(a.net) from alloc a where a.contribution_id is not distinct from k.contribution_id), 0)::bigint as allocated_cents,
       coalesce((select p.paid from paid p where p.contribution_id is not distinct from k.contribution_id), 0)::bigint as paid_cents,
       (k.contributed_cents - coalesce((select sum(a.net) from alloc a where a.contribution_id is not distinct from k.contribution_id), 0))::bigint as available_cents
  from buckets k;
revoke all on public.pool_buckets from anon, authenticated;
