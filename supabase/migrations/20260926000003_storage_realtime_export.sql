-- Storage buckets, realtime publication, dataset export view.

-- observations: private raw captures (uploads via server-issued signed upload URLs).
-- synthetic: AI-generated examples / red-team fakes; public-read so the app can show labeled examples.
insert into storage.buckets (id, name, public)
values ('observations', 'observations', false), ('synthetic', 'synthetic', true)
on conflict (id) do nothing;

-- Researchers may read raw observation images (the dashboard creates signed URLs client-side).
create policy observations_researcher_read on storage.objects
  for select to authenticated
  using (bucket_id = 'observations' and public.is_researcher());

-- Contributors may read their own uploads (path prefix = their user id).
create policy observations_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'observations' and (storage.foldername(name))[1] = auth.uid()::text);

create policy synthetic_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'synthetic');

-- Realtime: phone watches its submission's checks; dashboard watches submissions + bounties.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.submissions, public.bounties;

-- Accepted observations flattened with provenance. The protocol-specific extraction fields are
-- flattened into columns by the export route using the protocol's extraction schema; the view keeps
-- them as jsonb so it works for every protocol. security_invoker makes callers' RLS apply.
create view public.observations_export
with (security_invoker = true) as
select
  s.id as observation_id,
  s.bounty_id,
  b.title as bounty_title,
  p.slug as protocol_slug,
  p.version as protocol_version,
  s.lat,
  s.lng,
  s.accuracy_m,
  s.h3_cell,
  s.captured_at,
  s.received_at,
  s.confidence,
  s.protocol_score,
  s.authenticity_score,
  s.extracted,
  s.field_notes,
  s.reason_codes,
  s.user_id as contributor_id,
  pr.trust_score as contributor_trust,
  s.device->>'model' as device_model,
  s.device->>'os' as device_os,
  jsonb_array_length(s.media) as frame_count,
  (s.gate->>'degraded')::boolean as gate_degraded,
  s.reviewed_at is not null as human_reviewed
from public.submissions s
join public.bounties b on b.id = s.bounty_id
join public.protocols p on p.id = b.protocol_id
left join public.profiles pr on pr.id = s.user_id
where s.status = 'accepted';
