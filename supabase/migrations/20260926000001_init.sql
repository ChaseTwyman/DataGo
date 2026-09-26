-- GroundTruth schema (PRD §15).
-- Money is integer cents. Scores are double precision (numeric would arrive as strings in supabase-js).

create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('contributor', 'researcher', 'admin');
create type public.protocol_status as enum ('draft', 'published');
create type public.bounty_status as enum ('draft', 'active', 'paused', 'closed');
create type public.bounty_source as enum ('manual', 'nws', 'radar', 'demo');
create type public.session_status as enum ('open', 'submitted', 'expired', 'abandoned');
create type public.submission_status as enum ('pending', 'verifying', 'accepted', 'rejected', 'needs_review');
create type public.ledger_kind as enum ('payout', 'bonus', 'adjustment', 'reversal');
create type public.synthetic_kind as enum ('example', 'briefing', 'redteam', 'impact');
create type public.attack_type as enum ('ai_generated', 'recycled', 'wrong_place_time');

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'contributor',
  display_name text,
  occupation text,
  skills text[] not null default '{}',
  interests text[] not null default '{}',
  languages text[] not null default '{}',
  regular_areas jsonb not null default '[]',
  notification_prefs jsonb not null default '{}',
  trust_score double precision not null default 0.5 check (trust_score between 0 and 1),
  is_adult boolean not null default false,
  consent_license boolean not null default false,
  onboarding jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every auth user (anonymous contributors included) gets a profile row.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- protocols
create table public.protocols (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version integer not null default 1,
  name text not null,
  definition jsonb not null,
  example_image_path text,
  status public.protocol_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (slug, version)
);

-- ---------------------------------------------------------------- bounties
create table public.bounties (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id),
  created_by uuid references public.profiles (id) on delete set null,
  title text not null,
  summary text not null default '',
  area jsonb not null,
  center_lat double precision not null,
  center_lng double precision not null,
  radius_m double precision not null,
  h3_res integer not null default 9,
  cells text[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  event_started_at timestamptz,
  base_price_cents integer not null check (base_price_cents > 0),
  max_price_cents integer not null,
  target_per_cell integer not null default 5 check (target_per_cell > 0),
  priority double precision not null default 1,
  budget_cents integer not null default 0 check (budget_cents >= 0),
  spent_cents integer not null default 0 check (spent_cents >= 0),
  status public.bounty_status not null default 'draft',
  source public.bounty_source not null default 'manual',
  briefing_video_path text,
  created_at timestamptz not null default now(),
  check (max_price_cents >= base_price_cents),
  check (ends_at > starts_at)
);
create index bounties_status_idx on public.bounties (status);

-- ---------------------------------------------------------------- capture sessions
create table public.capture_sessions (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.bounties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  nonce text not null,
  challenge jsonb not null,
  cell text not null,
  start_lat double precision,
  start_lng double precision,
  price_quote_cents integer not null,
  quote_expires_at timestamptz not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status public.session_status not null default 'open',
  frame_checks integer not null default 0,
  -- one frame check in flight per session: set while a check runs
  frame_check_lock_until timestamptz,
  upload_paths text[] not null default '{}'
);
create index capture_sessions_user_idx on public.capture_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------- submissions
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.capture_sessions (id) on delete set null,
  bounty_id uuid not null references public.bounties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  media jsonb not null default '[]',
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  h3_cell text not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  device jsonb not null default '{}',
  sensors jsonb not null default '{}',
  gate jsonb not null default '{}',
  field_notes jsonb not null default '{}',
  status public.submission_status not null default 'pending',
  checks jsonb not null default '[]',
  reason_codes text[] not null default '{}',
  confidence double precision,
  protocol_score double precision,
  authenticity_score double precision,
  extracted jsonb,
  phashes text[] not null default '{}',
  payout_cents integer,
  retryable boolean not null default false,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);

-- Synthetic media must never reach submissions (PRD §13). Media paths are bucket-qualified
-- ("observations/<user>/<session>/0.jpg"); anything not in the observations bucket is refused.
-- Belt and braces with the API guard in apps/web/lib/verification/syntheticGuard.ts.
create or replace function public.guard_submission_media() returns trigger
language plpgsql as $$
begin
  if jsonb_typeof(new.media) <> 'array' then
    raise exception 'submissions.media must be an array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.media) m
     where coalesce(m->>'path', '') not like 'observations/%'
  ) then
    raise exception 'SYNTHETIC_MEDIA: submissions may only reference the observations bucket';
  end if;
  return new;
end $$;

create trigger submissions_media_guard
  before insert or update of media on public.submissions
  for each row execute function public.guard_submission_media();
create index submissions_bounty_idx on public.submissions (bounty_id, received_at desc);
create index submissions_user_idx on public.submissions (user_id, captured_at desc);
create index submissions_cell_idx on public.submissions (bounty_id, h3_cell, status);
create index submissions_status_idx on public.submissions (status);

-- ---------------------------------------------------------------- ledger
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete set null,
  amount_cents integer not null,
  kind public.ledger_kind not null,
  created_at timestamptz not null default now()
);
create index ledger_user_idx on public.ledger_entries (user_id, created_at desc);
-- at most one payout per submission
create unique index ledger_one_payout_per_submission on public.ledger_entries (submission_id) where kind = 'payout';

-- ---------------------------------------------------------------- weather alerts (NWS cache)
create table public.weather_alerts (
  id text primary key,
  event text not null,
  severity text,
  headline text,
  geometry jsonb,
  onset timestamptz,
  expires timestamptz,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- match cache
create table public.match_cache (
  user_id uuid not null references public.profiles (id) on delete cascade,
  bounty_id uuid not null references public.bounties (id) on delete cascade,
  skill_fit double precision not null,
  reason text,
  notification_copy text,
  computed_at timestamptz not null default now(),
  primary key (user_id, bounty_id)
);

-- ---------------------------------------------------------------- synthetic media & red team
create table public.synthetic_media (
  id uuid primary key default gen_random_uuid(),
  kind public.synthetic_kind not null,
  path text not null,
  prompt text,
  model text,
  created_at timestamptz not null default now()
);

create table public.redteam_runs (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.bounties (id) on delete cascade,
  attack_type public.attack_type not null,
  synthetic_media_id uuid references public.synthetic_media (id) on delete set null,
  source_submission_id uuid references public.submissions (id) on delete set null,
  pipeline_result jsonb not null default '{}',
  caught boolean not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers
-- Atomic budget spend: returns false (and changes nothing) when it would exceed the budget.
create or replace function public.spend_bounty_budget(p_bounty uuid, p_cents integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update public.bounties
     set spent_cents = spent_cents + p_cents
   where id = p_bounty and spent_cents + p_cents <= budget_cents
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- Claim the per-session frame-check slot (max 1 in flight, cap N per session).
create or replace function public.claim_frame_check(p_session uuid, p_user uuid, p_limit integer, p_lock_seconds integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare used integer;
begin
  update public.capture_sessions
     set frame_checks = frame_checks + 1,
         frame_check_lock_until = now() + make_interval(secs => p_lock_seconds)
   where id = p_session
     and user_id = p_user
     and status = 'open'
     and expires_at > now()
     and frame_checks < p_limit
     and (frame_check_lock_until is null or frame_check_lock_until < now())
  returning frame_checks into used;
  return used; -- null when not claimed
end $$;

create or replace function public.release_frame_check(p_session uuid) returns void
language sql security definer set search_path = public as $$
  update public.capture_sessions set frame_check_lock_until = null where id = p_session;
$$;
