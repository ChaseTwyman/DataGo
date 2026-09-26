# GroundTruth — Build Plan

Source of truth: `PRD.md` (product) + `BUILD_PROMPT.md` (technical). This plan breaks the milestones into tasks and files.

## Execution strategy

- **M0 is serial** and done first by the lead: every later track depends on `packages/shared` contracts, the DB schema, and the Grok wrapper.
- After M0, two **parallel tracks** meet at the shared contracts:
  - **Track W (platform/web):** API routes, pipeline, dashboard, red team, demo mode.
  - **Track M (mobile):** Expo app, voice, capture gate, wallet.
- Contracts change only in `packages/shared`, with tests. A track that needs a new contract field adds it there.
- Every milestone ends with: `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green, `STATUS.md` updated, commit `feat(mN): …`.

## Environment constraints discovered

- No Docker / Supabase CLI on the build machine: `supabase db reset` cannot run here. Migrations are validated by applying them to **PGlite** (in-process Postgres) with a small shim for Supabase-only schemas (`auth`, `storage`, roles, publication) in `supabase/test/`. Real `supabase db reset` is a human step in `STATUS.md`.
- No iPhone: mobile verified by `tsc`, unit tests of pure hooks/state machines, and `npx expo prebuild`.
- Repo lives under OneDrive: `node_modules` sync churn is possible. Recommend pausing OneDrive sync or excluding `node_modules`.

---

## Decision: local backend mode (made after M0)

No Supabase exists yet and none can run here, but M1 needs a headless end-to-end check. So the API reads/writes Postgres through a small SQL `Db` interface (`apps/web/lib/db`) with two drivers: `postgres` via `DATABASE_URL` (Supabase's Postgres) and **PGlite**, which applies the real migrations + seed. `LOCAL_BACKEND=1` = PGlite + local-disk storage + dev bearer tokens (`POST /api/dev/session`) + polling in place of realtime. Supabase mode = Supabase Auth, Storage, Realtime + `DATABASE_URL`. Dev routes/tokens are refused outside local mode. Tracks after M0: W1 (API + pipeline), W2 (dashboard UI), M (mobile), running in parallel against `packages/shared` contracts.

## M0 — Foundations and contracts

Root:
- `package.json` (scripts: `typecheck`, `lint`, `test`, `dev:web`, `eval:verification`, `demo:reset`), `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.npmrc`

`packages/shared/src/`:
- `protocols/protocol.ts` — `ProtocolSchema` (zod) + `Protocol` type
- `protocols/street-flood-depth.json` — PRD §8 verbatim; `protocols/index.ts`
- `reasonCodes.ts` — code list, integrity vs protocol classification, contributor-facing messages
- `pricing.ts` — `computePrice({base,max,accepted,target,hoursSinceEvent,tauHours,priority,paused})`, `lockQuote`, `payoutFor(quote, multiplier)`; tests reproduce $10.00 ×5.0 and $4.24 ×2.1
- `decision.ts` — `decide(input)` per PRD §9.3; tests for every hard fail + each band + trust < 0.3 + stage error → needs_review
- `trust.ts` — `updateTrust(score, outcome)`
- `h3.ts` — `cellsForCircle`, `cellsForPolygon`, `cellToGeoJSON`, `cellsToFeatureCollection`, `pointInCells`, `haversineM` (res 9)
- `verificationSchema.ts` — `buildVerificationJsonSchema(protocol)` + `frameCheckJsonSchema(protocol)` + zod runtime validators
- `checks.ts` — `StageResult` `{status, score, reasonCodes, evidence, ms}`, stage ids
- `contracts/*.ts` — request/response zod for every PRD §16 endpoint
- `index.ts`

`supabase/`:
- `config.toml`, `migrations/0001_init.sql` (tables PRD §15, enums, indexes), `migrations/0002_rls.sql`, `migrations/0003_storage_realtime.sql` (buckets, publication, `observations_export` view)
- `seed.sql` — researcher/admin `researcher@groundtruth.dev` (random password; never committed), flood protocol published, one active demo bounty
- `test/migrations.test.ts` — PGlite applies all migrations + seed

`apps/web/lib/grok/` (web app shell created minimally so the wrapper compiles):
- `client.ts` (OpenAI SDK → xAI), `json.ts` (`grokJSON`), `vision.ts` (frame check + verification callers), `imagine.ts` (`grokImage`, `grokVideoStart`, `grokVideoPoll`), `voiceToken.ts` (`mintVoiceToken`), `log.ts`, `mocks/*` (deterministic fixtures + screen-recapture variant via `x-mock-variant` header)
- tests for mock mode + zod validation + retry

## M0.5 — Voice spike
- web: `app/api/voice/token/route.ts`
- mobile scaffold: Expo app, `app.config.ts` (permissions, plugins), `app/voice-test.tsx`
- `src/voice/audio.ts` (Float32↔Int16↔base64 PCM helpers, tested), `src/voice/realtimeClient.ts` (event parsing, both event spellings), `src/voice/useGrokVoice.ts`
- `src/api/client.ts` typed on shared contracts; `src/lib/supabase.ts` anonymous auth

## M1 — Skeleton loop (mock AI)
- web API: `bounties/nearby`, `bounties/[id]`, `bounties` (POST), `bounties/[id]` (PATCH), `capture/sessions`, `submissions`, `lib/auth.ts` (bearer → user + role), `lib/supabase/{server,admin,browser}.ts`
- `lib/verification/pipeline.ts` + stage files; writes checks one by one
- dashboard: `(auth)/login`, `(dashboard)/layout.tsx` (left rail), `bounties/page.tsx`, `bounties/new/page.tsx`, `bounties/[id]/page.tsx` (MapLibre hex layer + realtime stream)
- mobile: `(tabs)/map`, `(tabs)/foryou`, `bounty/[id]`, `capture/[sessionId]`, `result/[submissionId]`
- `apps/web/scripts/e2e-mock.ts` — drives the loop through HTTP in mock mode

## M2 — Capture gate and challenge
- web: `capture/frame-check/route.ts` (1 in flight/session, cap 90)
- mobile: `src/capture/gateMachine.ts` (pure reducer, tested), `useCaptureGate.ts`, `useDeviceChecks.ts`, `burst.ts`, `ChecklistOverlay.tsx`

## M3 — Verification pipeline
- `lib/verification/stages/{sessionIntegrity,modelVerification,challenge,protocol,authenticity,context,duplicates,corroboration}.ts`, `lib/context/{openMeteo,nws,daylight}.ts`, `lib/image/dhash.ts`
- `scripts/eval-verification.ts`, `scripts/generate-examples.ts`, `test/fixtures/README.md`

## M4 — Voice field guide
- mobile: `src/voice/instructions.ts` (§7.3 builder, tested), `src/voice/tools.ts` (tool defs + handlers, tested), camera-status injection in `useGrokVoice`

## M5 — Economy and data
- web: `bounties/[id]/coverage`, `bounties/[id]/export`, `submissions/[id]/review`, `me/wallet`, `profile`; `lib/hazards.ts` (NWS pause); dashboard `review`, `datasets`, coverage heatmap
- mobile: `(tabs)/wallet`

## M6 — Imagine + red team
- web: `protocols/[id]/example-image`, `redteam/run`, `lib/redteam/*`, dashboard `red-team`; synthetic guard + test

## M7 — P1 (in order, stop when out of time)
1. onboarding + `save_profile` + match scoring + local notifications
2. Opportunity Radar
3. Protocol Studio + leaf-disease-scout
4. briefing video

## M8 — Demo readiness
- `demo/spawn-event`, `scripts/demo-reset.ts`, `README.md`, `DEMO.md`
