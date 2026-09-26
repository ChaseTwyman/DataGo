# GroundTruth — notes for future sessions

Read `PRD.md` (what) and `BUILD_PROMPT.md` (how; wins on technical choices). `PLAN.md` = task breakdown, `STATUS.md` = current state + human TODOs + device test steps.

## Layout
- `packages/shared` — all pure logic + zod contracts. Consumed as TS source (no build): Next via `transpilePackages`, Metro directly, scripts via `tsx`.
  - `protocols/` Protocol schema + `street-flood-depth.json`; `pricing.ts`; `decision.ts`; `trust.ts`; `h3.ts`; `checks.ts` (pipeline stage results); `verificationSchema.ts`; `reasonCodes.ts`; `contracts/` (one zod schema per endpoint); `demo.ts` (fixed seed ids).
- `supabase/` — migrations, generated `seed.sql`, PGlite-based migration tests.
- `apps/web` — Next.js App Router: dashboard + `app/api/*` route handlers. `lib/grok/` wraps every xAI call.
- `apps/mobile` — Expo dev build (not Expo Go).

## Commands (repo root)
- `pnpm check` — typecheck + lint + test everywhere. Must be green before every commit.
- `pnpm dev:web` — Next on 0.0.0.0:3000 (phone reaches it over LAN).
- `pnpm --filter @groundtruth/supabase seed:gen` — regenerate `supabase/seed.sql` from shared code. Never hand-edit seed.sql.
- `pnpm eval:verification`, `pnpm demo:reset`.

## Conventions
- TypeScript strict, `noUncheckedIndexedAccess`, no `any` (lint error). TS pinned to 6.0.x (typescript-eslint doesn't support 7).
- Money = integer cents. Scores = 0..1 doubles.
- Every API route: zod-parse input with the shared contract, verify auth (`Authorization: Bearer <supabase access token>` → `auth.getUser`), check `profiles.role` for researcher/admin routes.
- Storage media paths are **bucket-qualified**: `observations/<user>/<session>/<n>.jpg`. A DB trigger refuses submission media outside `observations/` (synthetic guard).
- Model names only from env (`lib/grok/config.ts`). `MOCK_GROK=1` → deterministic fixtures; `x-mock-variant` header selects failure variants (`screen_recapture`, `missing_element`, `ai_generated`, `error`, `slow`).
- Grok failure never auto-accepts: pipeline stage → `error` → `needs_review`.
- Commit messages: `git commit -F <file>`, explain why + what was rejected.

## Production
- Vercel project `groundtruth` (team `panoptic-pigskin`), https://groundtruth-two-snowy.vercel.app. Root dir `apps/web`, install `pnpm install --filter @groundtruth/web... --frozen-lockfile`, Corepack on (pnpm 12). Token file: `C:\Users\sumedh\.vercel-token.txt` (never print it).
- Deploy only from a clean `git worktree` of origin/main — the working copy has untracked/ignored files that hide missing-from-git bugs.
- The deploy folder MUST contain `.vercel/project.json` (`projectId: prj_PmojX6ZECwKYVflTpwNn4CbDj0Pl`). Deploying from an unlinked folder silently creates a NEW Vercel project (happened once: "gtd", deleted). Check the "Aliased" line says groundtruth-two-snowy.vercel.app.
- Hobby: route `maxDuration` ≤ 300.
- New migrations must be applied to hosted Supabase (via DATABASE_URL, session port 5432) BEFORE deploying code that uses them.

## Mobile gotchas
- Xcode 27 / iOS 27: UIScene life cycle is mandatory — `plugins/withSceneLifecycle.js` (needs `expo prebuild --clean` after changes).
- Entry is `apps/mobile/index.ts` (expo → UTF-16 TextDecoder polyfill → expo-router). Don't remove: h3-js needs it under Hermes.
- Don't add `NSAllowsLocalNetworking` to ATS; it disables `NSAllowsArbitraryLoads`.
- Phone: use `--configuration Release` builds (JS embedded). Dev builds need Metro reachable on every launch.

## Environment gotchas (Windows build machine)
- `sed -i` in this OneDrive folder has applied edits twice (duplicated lines). Use the Edit tool.
- Never gate on `cmd | tail`: the pipe hides the exit code.
- No Docker/Supabase CLI here; `supabase/test/migrations.test.ts` applies migrations + seed to PGlite with an auth/storage shim. Real `supabase db reset` is a human step.
- pnpm 12 requires build-script approval: add packages under `allowBuilds:` in `pnpm-workspace.yaml`.
- `python` on this machine is the Windows Store stub and hangs — use node.
- Repo lives in OneDrive; pause sync if node_modules churn is slow.
