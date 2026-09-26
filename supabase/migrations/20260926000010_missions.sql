-- Revisit missions, recession linkage, impact cards. Additive + idempotent.
--
-- 1. missions: follow-up demand on one H3 cell of one request after an accepted reading (flood:
--    +30/+60/+120 min, so recession curves can be measured). Created and filled only by the API
--    (lib/missions); priced by the platform engine and paid from the same request allocation, so
--    a mission is never money of its own. Server-only (RLS on, no policies, grants revoked).
-- 2. submissions.revisit_of / mission_id: a reading that filled a mission links to the reading that
--    created it (the first reading at the cell), so a curve = root + its revisits.
-- 3. impact_cards: one cached shareable card per accepted submission (image in the synthetic bucket;
--    never the raw photo, never precise location, no personal data). Server-only.
-- 4. street-flood-depth v1 gains its revisit schedule (same as packages/shared JSON).

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.bounties (id) on delete cascade,
  cell text not null,
  source_submission_id uuid not null references public.submissions (id) on delete cascade,
  original_user_id uuid references auth.users (id) on delete set null,
  sequence int not null check (sequence between 1 and 6),
  interval_min int not null check (interval_min > 0),
  opens_at timestamptz not null,
  due_at timestamptz not null,
  dibs_until timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'filled', 'expired', 'cancelled')),
  filled_submission_id uuid references public.submissions (id) on delete set null,
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  check (opens_at <= due_at and due_at <= closes_at and opens_at <= dibs_until and dibs_until <= closes_at),
  unique (source_submission_id, sequence)
);
create index if not exists missions_bounty_cell_idx on public.missions (bounty_id, cell, status);
create index if not exists missions_open_closes_idx on public.missions (closes_at) where status = 'open';
-- A reading fills at most one mission.
create unique index if not exists missions_filled_submission_uidx on public.missions (filled_submission_id) where filled_submission_id is not null;

alter table public.missions enable row level security;
revoke all on public.missions from anon, authenticated;

alter table public.submissions add column if not exists revisit_of uuid references public.submissions (id) on delete set null;
alter table public.submissions add column if not exists mission_id uuid references public.missions (id) on delete set null;
create index if not exists submissions_revisit_of_idx on public.submissions (revisit_of) where revisit_of is not null;

create table if not exists public.impact_cards (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  path text not null check (path like 'synthetic/impact/%'),
  ai_background boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists impact_cards_ai_created_idx on public.impact_cards (created_at) where ai_background;

alter table public.impact_cards enable row level security;
revoke all on public.impact_cards from anon, authenticated;

update public.protocols
   set definition = definition || jsonb_build_object(
         'revisit',
         '{"intervals_min": [30, 60, 120], "max": 3, "first_dibs_min": 10, "window_min": 20, "early_min": 5}'::jsonb)
 where slug = 'street-flood-depth'
   and not (definition ? 'revisit');
