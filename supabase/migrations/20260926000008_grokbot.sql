-- Grokbot (role-scoped operator). Additive + idempotent.
--
-- 1. grokbot_cache: generated explanations / briefs / reports keyed by what they explain. The key's
--    `version` is a hash of the role-scoped case file the text was grounded in, so a status change,
--    a new stage result, or a price move produces a new key (old rows simply expire). `audience` is a
--    role scope ("contributor", "researcher", "admin", "public"), never a user id: the same case
--    file for the same role yields the same text, and deleting an account leaves nothing behind.
--    Server-only (RLS on, no policies, grants revoked): clients read through the API, which checks
--    who may see which audience.
-- 2. protocols.self_check: the latest Studio self-check (StudioSelfCheck JSON). Advisory only:
--    publishing never reads it; the dashboard shows it and warns.
-- 3. match_cache.computed_at already exists (000001); an index for the "stale for this user" scan.

create table if not exists public.grokbot_cache (
  kind text not null check (char_length(kind) <= 40),
  subject_id text not null check (char_length(subject_id) <= 200),
  audience text not null check (audience in ('contributor', 'researcher', 'admin', 'public')),
  version text not null check (char_length(version) <= 80),
  payload jsonb not null,
  source text not null check (source in ('grok', 'template')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (kind, subject_id, audience, version)
);
create index if not exists grokbot_cache_expires_idx on public.grokbot_cache (expires_at);

alter table public.grokbot_cache enable row level security;
revoke all on public.grokbot_cache from anon, authenticated;

alter table public.protocols add column if not exists self_check jsonb;

create index if not exists match_cache_user_computed_idx on public.match_cache (user_id, computed_at);
