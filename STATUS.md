# GroundTruth — Status

_Last updated: M0 complete._

## Milestones
| # | Milestone | State |
|---|---|---|
| M0 | Foundations and contracts | ✅ done |
| M0.5 | Voice spike | ⏳ next (needs device) |
| M1 | Skeleton loop (mock AI) | ⏳ |
| M2 | Capture gate + challenge | ⏳ |
| M3 | Verification pipeline | ⏳ |
| M4 | Voice field guide | ⏳ |
| M5 | Economy + data | ⏳ |
| M6 | Imagine + red team | ⏳ |
| M7 | P1 features | ⏳ |
| M8 | Demo readiness | ⏳ |

## M0 — what exists
- `packages/shared`: protocol schema + flood protocol, pricing (PRD §10 example reproduced), decision rules (PRD §9.3), trust, H3, verification/frame-check JSON schemas, reason codes, zod contracts for all PRD §16 endpoints. 50 tests.
- `supabase/`: 3 migrations (all PRD §15 tables, RLS, buckets, realtime publication, `observations_export` view, budget/frame-check helper functions, synthetic-media trigger), generated `seed.sql` (admin researcher, published flood protocol, active demo bounty at Georgia Tech). 13 PGlite tests incl. RLS (mutation-checked: disabling submissions RLS fails 2 tests).
- `apps/web/lib/grok`: `grokJSON`, `frameCheck`, `verifyCapture`, `grokImage`, `grokVideoStart/Poll`, `mintVoiceToken`, mock fixtures. 14 tests.

## Real vs mocked
- All Grok calls: real code path written against docs.x.ai (verified 2026-09-26), exercised only with a stubbed SDK so far. Mock mode fully works.
- `supabase db reset`: **not run** (no Docker here). Migrations verified on PGlite 0.5 (Postgres 17) with a shim for `auth`/`storage`.

## Known issues / decisions
- Ephemeral token response shape isn't documented; `parseClientSecret` accepts `{value}`, `{client_secret:{value}}`, `{token}` and logs the keys on the first real call.
- Decision rules beyond the PRD: weak (<0.8) authenticity suspicion, edited/composited, velocity, impossible travel → capped at `needs_review`. Missing element / protocol score below minimum → retryable reject.

## Human TODOs
- [ ] Create Supabase project (or `supabase start`), run `supabase db reset`, fill `apps/web/.env` and `apps/mobile/.env`.
- [ ] Add `XAI_API_KEY` to `apps/web/.env`.
- [ ] Sign iOS build in Xcode with an Apple ID; enable Developer Mode on the iPhone.
- [ ] Same network for laptop + phone (or tunnel); set `EXPO_PUBLIC_API_BASE_URL`.
- [ ] ~20 real test photos (good + bad) in `apps/web/test/fixtures`.

## Device test steps
_(added per milestone)_
