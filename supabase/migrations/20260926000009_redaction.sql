-- Face / licence-plate redaction (PRD §13). Additive + idempotent.
--
-- 1. submissions.redaction: summary of the post-decision redaction job
--    {status: pending|done|failed, at, model, frames: [{faces, plates, whole_frame}], error?}.
--    media[i].redacted_path (inside the existing media jsonb) points at the blurred derivative,
--    stored next to the original: observations/<user>/<session>/<n>.redacted.jpg.
-- 2. The media guard also checks redacted_path: a derivative must live in the observations bucket.
-- 3. Storage: non-admin researchers may read ONLY redacted derivatives; originals are readable by
--    admins (audit/review) and by the contributor who took them (observations_owner_read, 000006).
--    Before this, observations_researcher_read let any researcher (self-serve) read every original.

alter table public.submissions add column if not exists redaction jsonb;

create or replace function public.guard_submission_media() returns trigger
language plpgsql as $$
begin
  if jsonb_typeof(new.media) <> 'array' then
    raise exception 'submissions.media must be an array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.media) m
     where coalesce(m->>'path', '') not like 'observations/%'
        or (m ? 'redacted_path' and coalesce(m->>'redacted_path', '') not like 'observations/%')
  ) then
    raise exception 'SYNTHETIC_MEDIA: submissions may only reference the observations bucket';
  end if;
  return new;
end $$;

-- Object names are <user>/<session>/<n>[.redacted].jpg: the session folder names the bounty. Security
-- definer so the lookup doesn't depend on the caller's RLS on capture_sessions.
create or replace function public.owns_observation_bounty(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.capture_sessions cs join public.bounties b on b.id = cs.bounty_id
     where cs.id::text = (storage.foldername(object_name))[2] and b.created_by = auth.uid()
  );
$$;

drop policy if exists observations_researcher_read on storage.objects;
create policy observations_researcher_read on storage.objects
  for select to authenticated
  using (bucket_id = 'observations' and public.is_researcher() and name like '%.redacted.jpg'
         and public.owns_observation_bounty(name));

drop policy if exists observations_admin_read on storage.objects;
create policy observations_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'observations' and public.is_admin());
