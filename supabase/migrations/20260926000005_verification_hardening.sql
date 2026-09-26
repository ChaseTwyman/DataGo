-- Verification hardening after the vitamin-water incident. Additive only.
--
-- What happened: a tester aimed the phone at a vitamin-water bottle for a street-flood bounty. No real
-- frame check ever succeeded, the phone's gate degraded after 10 s and unlocked the shutter, and the
-- server trusted the phone's gate claims. The grok-4.7 call then timed out; only a human reviewer
-- stopped it. Separately, the public dataset held 40 seed-script rows and one row "accepted" by
-- MOCK_GROK (which approves anything) against the real database.
--
-- 1. submissions.verifier: who decided (model | mock | human | none). mock/none rows never reach
--    researcher exports or public data.
-- 2. capture_sessions.green_streak / gate_passed_at: the capture gate recorded server-side. A session
--    that never passed can't be auto-accepted or auto-paid (reason GATE_NOT_PASSED).
-- 3. observations_export gains verifier + quality_tier and excludes mock/none rows.
-- 4. The street-flood-depth protocol gets its extraction plausibility rules (same values as
--    packages/shared/src/protocols/street-flood-depth.json).

-- ---------------------------------------------------------------- 1. provenance
alter table public.submissions
  add column if not exists verifier text not null default 'model';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_verifier_check') then
    alter table public.submissions add constraint submissions_verifier_check
      check (verifier in ('model', 'mock', 'human', 'none'));
  end if;
end $$;

-- Backfill (idempotent): rows written by demo/seed tooling were never verified; reviewed rows were
-- decided by a human. Everything else predates this column and was decided by the pipeline.
update public.submissions set verifier = 'none'
 where verifier = 'model' and device->>'model' in ('demo-seed', 'seed-script');
update public.submissions set verifier = 'human'
 where verifier = 'model' and reviewed_at is not null;

-- ---------------------------------------------------------------- 2. server-side capture gate
alter table public.capture_sessions
  add column if not exists green_streak integer not null default 0,
  add column if not exists gate_passed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'capture_sessions_green_streak_check') then
    alter table public.capture_sessions add constraint capture_sessions_green_streak_check check (green_streak >= 0);
  end if;
end $$;
-- Contributors have no UPDATE policy on capture_sessions or submissions (RLS), so neither the gate
-- state nor the verifier can be written from a client; only the API's own connection writes them.

-- ---------------------------------------------------------------- 3. export view
-- Same columns in the same order (create or replace view may only append), plus verifier and
-- quality_tier. quality_tier mirrors qualityTier() in packages/shared/src/provenance.ts:
-- human_verified (a reviewer approved), model_high (pipeline accepted at confidence >= 0.75),
-- null (not publishable).
create or replace view public.observations_export
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
  s.reviewed_at is not null as human_reviewed,
  s.verifier,
  case
    when s.verifier = 'human' then 'human_verified'
    when s.verifier = 'model' and s.confidence >= 0.75 then 'model_high'
  end as quality_tier
from public.submissions s
join public.bounties b on b.id = s.bounty_id
join public.protocols p on p.id = b.protocol_id
left join public.profiles pr on pr.id = s.user_id
where s.status = 'accepted'
  and s.verifier not in ('mock', 'none');

-- ---------------------------------------------------------------- 4. flood extraction rules
update public.protocols
   set definition = jsonb_set(
         definition,
         '{acceptance,extraction_rules}',
         '[{"kind": "required_number", "field": "depth_cm", "min": 0},
           {"kind": "max_relative", "field": "depth_cm", "reference_field": "reference_object_assumed_height_cm", "factor": 1.1},
           {"kind": "min_confidence", "field": "depth_confidence", "min": 0.4}]'::jsonb,
         true)
 where slug = 'street-flood-depth'
   and version = 1
   and not (definition->'acceptance' ? 'extraction_rules');
