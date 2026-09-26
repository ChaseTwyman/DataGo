-- Open data + sponsors. Additive only: two nullable columns and one server-only settings table.
--
-- Product rule: every structured dataset is free and open (no login). Sponsors pay to direct
-- collection ("Funded by X — data free for everyone"). Photos are never published (PRD §13).

alter table public.bounties
  add column if not exists sponsor_name text,
  add column if not exists sponsor_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bounties_sponsor_name_len') then
    alter table public.bounties add constraint bounties_sponsor_name_len
      check (sponsor_name is null or char_length(sponsor_name) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bounties_sponsor_url_len') then
    alter table public.bounties add constraint bounties_sponsor_url_len
      check (sponsor_url is null or char_length(sponsor_url) <= 300);
  end if;
end $$;

-- Server-only key/value settings. RLS on with no policies: anon/authenticated read nothing; the API
-- reads it over its own database connection.
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- Salt for public-dataset pseudonyms: contributor_id = sha256(salt:protocol_slug:user_id), truncated.
-- Two gen_random_uuid() values = 244 random bits, and needs no extension. Never overwritten: rotating
-- it would re-key every published pseudonym.
insert into public.app_settings (key, value)
values ('public_dataset_salt', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;
