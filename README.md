# GroundTruth

**A bounty board for reality.** Researchers post paid requests for real-world observations (a place, a
time window, a capture protocol). A pricing engine surges the reward where data is scarce and urgent.
On the phone, a Grok Voice field guide and live Grok vision checks coach the contributor through the
protocol, and **the shutter stays locked until the shot meets it**. Every submission then runs through
a layered verification pipeline before it is paid (simulated wallet) and lands in a structured,
privacy-coarsened open dataset.

The hero protocol is **street flood depth**. A red-team console attacks our own verification with
Grok Imagine fakes.

- Production (web dashboard + API): https://groundtruth-two-snowy.vercel.app
- Open data, no login: [`/data`](https://groundtruth-two-snowy.vercel.app/data) and
  [`/api/public/datasets`](https://groundtruth-two-snowy.vercel.app/api/public/datasets) (CC BY 4.0,
  privacy-coarsened, never photos)
- Product spec: [`PRD.md`](PRD.md) · technical spec: [`BUILD_PROMPT.md`](BUILD_PROMPT.md) · task plan:
  [`PLAN.md`](PLAN.md) · current state: [`STATUS.md`](STATUS.md) · demo runbook: [`DEMO.md`](DEMO.md) ·
  notes for coding agents: [`CLAUDE.md`](CLAUDE.md)

---

## Contents

1. [Architecture](#architecture)
2. [Setup from zero](#setup-from-zero)
3. [Testing](#testing)
4. [Operations](#operations)
5. [Security and privacy model](#security-and-privacy-model)
6. [Known limitations](#known-limitations)

---

## Architecture

### Monorepo layout (pnpm workspaces, TypeScript everywhere)

| Path | What it is |
|---|---|
| `packages/shared` | All pure logic and contracts, consumed as TS source (no build step): protocol schema + `street-flood-depth.json`, `pricing.ts` (surge), `decision.ts` (`decide()`), `trust.ts`, `h3.ts` (res-9 hexes), `reasonCodes.ts`, `provenance.ts`, `extractionSanity.ts`, and one zod contract per API endpoint in `contracts/`. |
| `supabase/` | SQL migrations, generated `seed.sql` (never hand-edit: `pnpm --filter @groundtruth/supabase seed:gen`), and PGlite-based migration tests. |
| `apps/web` | Next.js (App Router): the researcher dashboard, the public `/data` page, and every API route under `app/api/*`. `lib/grok/` wraps every xAI call; `lib/verification/` is the pipeline. Deployed to Vercel. |
| `apps/mobile` | Expo (React Native) **development build**, not Expo Go: bounty map/feed, briefing, voice-guided capture, results, wallet, account. iOS first. |

Migrations (applied in order):

| File | Adds |
|---|---|
| `20260926000001_init.sql` | Tables, enums, indexes (PRD §15) |
| `20260926000002_rls.sql` | Row-level security |
| `20260926000003_storage_realtime_export.sql` | Storage buckets, realtime publication, export view |
| `20260926000004_open_data.sql` | Public dataset support, sponsor fields |
| `20260926000005_verification_hardening.sql` | Server-side capture gate, verifier provenance, quality tier |
| `20260926000006_accounts.sql` | Account flags (researcher/admin), suspension, deleted-user placeholder, retention, rate limits |
| `20260926000007_sponsor_pool.sql` | Sponsor pool, contributions, allocation ledger |
| `20260926000008_grokbot.sql` | Grokbot cache, protocol self-check |
| `20260926000009_redaction.sql` | `submissions.redaction`, `media[i].redacted_path` guard, researchers read only redacted photos in storage |
| `20260926000010_missions.sql` | Revisit missions, `submissions.revisit_of` / `mission_id`, impact cards |

### Request flow

```
Phone (Expo)                         Vercel: Next.js API                     Services
------------                         -------------------                     --------
sign in (Supabase Auth) ───────────────────────────────────────────────────► Supabase Auth
GET  /api/bounties/nearby ─────────► pricing + H3 coverage ────────────────► Postgres
GET  /api/bounties/:id   (briefing, AI example image, locked price)
POST /api/voice/token ─────────────► mints an ephemeral xAI token
phone ◄══ realtime voice WebSocket ══════════════════════════════════════════► xAI Grok Voice
POST /api/capture/sessions ────────► session, nonce, challenge, signed upload URLs
POST /api/capture/frame-check ─────► fast vision on a 640 px frame ────────► xAI (grok-4.20)
     (every ~1.2 s while framing; server records gate_passed after 2 real all-green checks)
PUT  3 burst JPEGs ────────────────────────────────────────────────────────► Supabase Storage (private)
POST /api/submissions ─────────────► responds, then runs the pipeline in after()
     phone + dashboard watch submissions.checks via Supabase Realtime ◄──── Postgres
```

- The **xAI key never leaves the server**; the phone only ever holds a short-lived voice token.
- The API talks to Postgres directly over `DATABASE_URL` (service-level connection; see
  [Security](#security-and-privacy-model)). Every route zod-parses input with the shared contract and
  checks the bearer token itself.
- Long work (verification, red-team runs, Imagine) runs after the response; route `maxDuration` is
  capped at 300 s on the Vercel Hobby plan.

### Verification pipeline

`apps/web/lib/verification/pipeline.ts` runs these stages (session integrity first; the grok-4.7 call then starts concurrently with relevance, and the rest run concurrently once relevance has passed). Each writes a result (status,
score, reason codes, evidence, duration) into `submissions.checks` as it starts and finishes, which is
what animates the checklist on the phone and the dashboard.

| # | Stage | What it does |
|---|---|---|
| 1 | **Session integrity** | Open, unexpired session; nonce; capture window; and the **server-authoritative capture gate**: the session must have recorded 2 consecutive real all-green frame checks, or the submission is refused with `GATE_NOT_PASSED` and never paid. A failure here stops the pipeline (nothing is sent to a model). |
| 2 | **Relevance** | Fast vision model (~2 s): is this even the subject of the protocol? Off-topic → `OFF_TOPIC` reject; the in-flight reasoning call is aborted and its stages are skipped. |
| 3 | **Challenge-response** | The random challenge (e.g. "step left") was performed; the 3-frame burst shows real parallax. Identical burst frames fail even if the model is fooled. |
| 4 | **Protocol compliance + extraction** | Required elements, quality, structured fields (depth estimate etc.), plus deterministic extraction sanity rules. |
| 5 | **Authenticity** | Screen recapture, print, AI generation, editing, internal inconsistencies (grok-4.7, skeptical prompt) **plus a C2PA / IPTC provenance check** that hard-fails with `C2PA_AI_GENERATED` when the file declares itself AI-generated, independent of the model. |
| 6 | **Context** | Inside the bounty area and window, recent precipitation (Open-Meteo), NWS alerts, daylight vs sun position. `DEMO_MODE=1` shows precipitation as "waived (demo)", never hidden. |
| 7 | **Duplicates** | Perceptual hash, per-cell velocity, impossible travel. |
| 8 | **Corroboration** | Agreement with nearby accepted observations; contributor trust score. |

Stages 3-5 share one grok-4.7 reasoning call (`stages/modelVerification.ts`).

**`decide()`** (`packages/shared/src/decision.ts`) turns stage results into `accepted` /
`needs_review` / `rejected` per PRD §9.3: hard fails reject; otherwise a weighted confidence
(≥ 0.75 accept, 0.50-0.75 or trust < 0.3 review, < 0.50 reject). Additional rules: a stage that errors
(e.g. Grok timeout) goes to **needs_review, never auto-accept**; weak authenticity suspicion or
velocity/travel flags cap at needs_review; protocol-quality misses are retryable in a new session;
integrity failures are not.

**Verifier provenance.** Every decision records `submissions.verifier` = `model`, `mock`, `human`, or
`none`. Mock (`MOCK_GROK`) and seed/demo rows are never exported or published.

**Measured on Vercel with real Grok:** frame check ~1.3 s, relevance ~2 s, grok-4.7 verification
~41 s at `reasoning_effort: medium` (`GROK_VERIFICATION_EFFORT`). Reasoning tokens are the latency
(4–13k per call; images are ~2.9k input tokens each). `low` effort was measured and rejected: it
accepted both pseudo-parallax Imagine fakes in the eval set. Relevance now overlaps the model call
(~2 s saved). Knobs (defaults unchanged): `VERIFICATION_FRAME_MAX_EDGE` (1536),
`VERIFICATION_IMAGE_DETAIL` (high|mixed|low), `GROK_VERIFICATION_TIMEOUT_MS` (150000).

### Face / licence-plate redaction

After the decision (`after()` in `POST /api/submissions`), `lib/verification/redaction.ts` asks the
fast vision model for face and plate boxes in each frame, pixelates + blurs them with sharp and stores
`observations/<user>/<session>/<n>.redacted.jpg` next to the original (`media[i].redacted_path`,
summary in `submissions.redaction`). Verification, dHash and C2PA only ever read originals.

- Researchers (dashboard, API) get only redacted URLs, and nothing while redaction is pending or
  failed. Admins additionally get `original_media_urls`. The contributor sees their own originals.
  Storage RLS matches: non-admin researchers can read only `*.redacted.jpg`. Photos are never in
  exports or open data.
- Failures never change a decision; they are recorded (`redaction.status = failed`, attempts) and
  retried by the daily cron (5 per run) or `pnpm --filter @groundtruth/web backfill:redaction`.
- **Limit:** the model finds faces/plates but its boxes are off by 4–10 % of the frame, so each box is
  grown by max(1× its size, 8 % of the long edge) before blurring. Blurred areas are large and can hide
  a nearby depth reference (the tire under a plate); admins still have the original. If the model says
  something is present but returns no box, the whole frame is blurred. Missed detections are possible.

### Data flow to the open dataset

1. Accepted submission → the researcher's private export (`GET /api/bounties/:id/export`, CSV or GeoJSON).
2. **Publishing rule:** a row becomes public only if it is accepted **and** (human-approved, or
   `verifier = model` with confidence ≥ 0.75). That is its `quality_tier`. Enforced twice: in SQL and
   again over every row in `lib/openData.ts`.
3. **Coarsening** (`lib/openData.ts`, the only place privacy is applied to public formats): location →
   centre of the H3 res-9 cell; time floored to 5 minutes; contributor → per-dataset pseudonym;
   observation id → pseudonym; free-text fields, device model, trust and **all media** withheld.
4. One public dataset per published protocol, at `/data` and
   `/api/public/datasets[/<slug>?format=csv|geojson|json|dictionary]`, licensed CC BY 4.0.

---

## Setup from zero

### Prerequisites

| Need | For |
|---|---|
| Node ≥ 22 and pnpm 12 (`corepack enable`; the repo pins `pnpm@12.6.0`) | everything |
| A Supabase project (hosted), or the Supabase CLI + Docker for `supabase start` | Supabase mode |
| An xAI API key | real Grok (not needed with `MOCK_GROK=1` in local mode) |
| Vercel CLI (`npx vercel`) and access to team `panoptic-pigskin` | deploying |
| A Mac with Xcode 27, CocoaPods, a (free) Apple ID, an iPhone with Developer Mode on | the iOS app |

```bash
git clone <repo> && cd DataCollectionHackathon
pnpm install
```

pnpm 12 requires approving packages with build scripts: they are listed under `allowBuilds:` in
`pnpm-workspace.yaml`.

### Backend: hosted Supabase or `supabase start`

- **Hosted (what production uses):** create a project, then apply every file in
  `supabase/migrations/` in order, then `supabase/seed.sql`. Use the SQL editor, `psql` against the
  session connection string (port 5432), or `supabase db push` on a linked project. The migrations are
  written to be idempotent.
- **Local Supabase:** `supabase start` (Docker) reads `supabase/config.toml`, then `supabase db reset`
  applies migrations + seed.
- **Auth settings** (Supabase dashboard → Authentication): email + password. Sign-up goes through our
  API (`POST /api/auth/signup`), which creates users already confirmed, so no confirmation email is
  needed. For forgot-password, configure custom SMTP (we use Resend, sender `no-reply@panopticpigskin.tech`),
  make the recovery email template include the 6-digit code, and add
  `$NEXT_PUBLIC_SITE_URL/reset-password` to Redirect URLs.

The seed creates the admin/researcher `researcher@groundtruth.dev` with a random password that is
**not** in the repo (`seed.sql` holds only a bcrypt hash). Set a known one with
[`rotate-admin-password.ts`](#rotating-the-admin-password).

### Environment files

Copy the examples and fill them in. Neither `.env` is committed.

**`apps/web/.env`** (from `apps/web/.env.example`): server only.

| Variable | Notes |
|---|---|
| `XAI_API_KEY`, `XAI_BASE_URL` | xAI. **Secret.** |
| `GROK_REASONING_MODEL`, `GROK_FAST_VISION_MODEL`, `GROK_IMAGE_MODEL`, `GROK_VIDEO_MODEL`, `GROK_VOICE_MODEL`, `GROK_VERIFICATION_EFFORT` | Model names live only in env (`lib/grok/config.ts`). Effort `medium` keeps verification near 40 s (`low` failed the eval). |
| `VERIFICATION_FRAME_MAX_EDGE`, `VERIFICATION_IMAGE_DETAIL`, `GROK_VERIFICATION_TIMEOUT_MS` | Verification frame size (1536), per-frame image detail (`high`), call budget (150000 ms). Defaults are the audited configuration. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** Bypasses RLS. |
| `DATABASE_URL` | Postgres connection string of the Supabase project. **Secret.** The transaction pooler (6543) works; use the session port (5432) for migrations. |
| `LOCAL_BACKEND` | `1` = no Supabase at all (see below). Never on a shared deployment. |
| `MOCK_GROK` | `1` = deterministic Grok fixtures that approve anything. Refused unless `LOCAL_BACKEND=1`. Keep `ALLOW_MOCK_ON_REAL_DB=0`. |
| `DEMO_MODE` | `1` = spawn-event route on, precipitation check waived (shown as waived). |
| `CRON_SECRET` | 16+ random chars; the retention cron is refused without it. **Secret.** |
| `REJECTED_MEDIA_RETENTION_DAYS` | Default 30. |
| `NEXT_PUBLIC_SITE_URL` | Public origin, no trailing slash; reset-password links point here. |
| `NWS_USER_AGENT`, `HAZARD_PAUSE_EVENTS`, `OFFLINE_CONTEXT` | Weather context and hazard pause. |
| `E2E_RESEARCHER_PASSWORD` | Only for running `e2e:mock` against Supabase. |
| `RATE_LIMITS_DISABLED` | Local mode only; ignored on a real backend. |

**`apps/mobile/.env`** (from `apps/mobile/.env.example`): **everything here is bundled into the app and
readable by anyone who has it.**

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `https://groundtruth-two-snowy.vercel.app` (or `http://<laptop-LAN-IP>:3000` for a local server) |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Same project as the web app |
| `EXPO_PUBLIC_GROK_VOICE_MODEL`, `EXPO_PUBLIC_VOICE_REASONING_EFFORT` | Defaults are fine |

> **Never put on the phone:** `XAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
> `CRON_SECRET`, or any password. The phone gets voice access through a short-lived token minted by
> `POST /api/voice/token`.

### Running the web app locally

**Mode A: no accounts, no services** (PGlite in-process Postgres with the real migrations + seed,
filesystem storage, dev bearer tokens, polling instead of realtime):

```bash
# bash
LOCAL_BACKEND=1 MOCK_GROK=1 DEMO_MODE=1 pnpm dev:web
```
```powershell
# PowerShell
$env:LOCAL_BACKEND="1"; $env:MOCK_GROK="1"; $env:DEMO_MODE="1"; pnpm dev:web
```

Open http://localhost:3000 and choose **Continue as demo researcher**. Drop `MOCK_GROK` to call real
Grok with a real `XAI_API_KEY`. Data lives in `apps/web/.local/` (`pnpm demo:reset` wipes it; stop
`next dev` first, PGlite is single-process). Password-reset codes are printed to the dev console.

**Mode B: Supabase** (`LOCAL_BACKEND=0`, a working `DATABASE_URL` and Supabase keys): `pnpm dev:web`,
then sign in with a real account. `MOCK_GROK=1` is refused here on purpose.

`pnpm dev:web` binds `0.0.0.0:3000`, so a phone on the same Wi-Fi can reach it by LAN IP.

### Deploying to Vercel

Production is the Vercel project `groundtruth` (team `panoptic-pigskin`, Hobby, region `iad1`). The
project's root directory is `apps/web`; env vars live in the Vercel project (`LOCAL_BACKEND=0`,
`MOCK_GROK=0`, `DEMO_MODE=1`, plus the secrets above). `vercel.json` schedules the retention cron.

1. **Migrations first.** Apply any new migration to hosted Supabase *before* deploying code that uses it.
2. **Deploy from a clean worktree of `origin/main`,** never the working copy (untracked or ignored files
   there once hid a route that was missing from git):
   ```bash
   git fetch origin
   git worktree add ../gt-deploy origin/main
   cd ../gt-deploy
   # link once if this worktree has no .vercel/ yet:
   npx vercel link --yes --project groundtruth --scope panoptic-pigskin
   VERCEL_TOKEN=<your token> npx vercel deploy --prod --yes --scope panoptic-pigskin
   cd - && git worktree remove ../gt-deploy
   ```
3. Check `GET /api/health`: expect `ok: true`, `backend: "supabase"`, `mock_grok: false`.

### Building the iPhone app (Mac)

The team develops on Windows; iOS is built on a Mac with Xcode 27 and a free Apple ID (Personal Team).

```bash
git pull && pnpm install
cd apps/mobile
# apps/mobile/.env: EXPO_PUBLIC_API_BASE_URL=https://groundtruth-two-snowy.vercel.app + Supabase URL + anon key
IOS_BUNDLE_ID=com.<yourname>.groundtruth npx expo prebuild --platform ios --clean
npx expo run:ios --device "<iPhone name>" --configuration Release
```

- **Release** embeds the JS bundle: after install the phone needs no Metro and no LAN, only internet.
  Debug builds need Metro reachable on every launch.
- First install: pick your Personal Team in Xcode if asked, then trust the developer profile on the
  phone (Settings → General → VPN & Device Management).
- **Free signing expires after 7 days.** Rebuild before any demo.
- A free Personal Team needs a globally unique bundle id, hence `IOS_BUNDLE_ID`.

**Simulator:** `npx expo run:ios` (camera features are limited in the simulator).

**Known pitfalls (keep these as they are):**

| Pitfall | What to do |
|---|---|
| iOS 27 SDK aborts apps without the UIScene life cycle | `plugins/withSceneLifecycle.js` adopts it. Keep it; re-run `expo prebuild --clean` after changing it. |
| h3-js needs a UTF-16 `TextDecoder`, which Hermes/Expo lack | The entry is `apps/mobile/index.ts` (expo → UTF-16 polyfill → expo-router). Keep that order. |
| App Transport Security | Do **not** add `NSAllowsLocalNetworking`: iOS then ignores `NSAllowsArbitraryLoads`. |
| `git pull` on the Mac complains about local changes | `git restore pnpm-lock.yaml apps/mobile/tsconfig.json`, then pull again. |
| Pod install fails on module resolution | Try `nodeLinker: hoisted` in `pnpm-workspace.yaml`, `pnpm install`, retry. |
| Push entitlement can't be signed by a free team | `expo-notifications` is intentionally not installed. |

---

## Testing

| Command | What it proves |
|---|---|
| `pnpm check` (repo root) | Typecheck + lint + unit/integration tests in every package (shared, supabase migrations on PGlite, web API + pipeline, mobile reducers/clients). Must be green before every commit. |
| `BASE_URL=http://localhost:3000 pnpm --filter @groundtruth/web e2e:mock` | The whole loop over HTTP against a running server (start it with `LOCAL_BACKEND=1 MOCK_GROK=1 DEMO_MODE=1`): session → frame checks (incl. `screen_recapture`) → upload → submit → accepted + wallet credited → coverage → CSV/GeoJSON export → red team (`ai_generated`, `recycled`) caught. Against Supabase it signs in as the admin with `E2E_RESEARCHER_PASSWORD`. |
| `pnpm --filter @groundtruth/mobile smoke` | The phone's own API client and gate reducer against a running local server. |
| `pnpm eval:verification` | The **real** pipeline over labeled bursts in `apps/web/test/fixtures/` (see its [README](apps/web/test/fixtures/README.md)): confusion table, stage timings, token usage. Exits 1 on any miss. Costs real Grok calls; `MOCK_GROK=1 LOCAL_BACKEND=1 ... --smoke` is a free dry run. Pull real captures into fixtures with `scripts/pull-submission-fixture.ts` (look at the photos before committing: bystanders, plates). |

**Mutation-check your tests.** When a test guards a rule (a hard fail, a publishing filter, an auth
check), break the rule on purpose and confirm the test goes red, then restore it. If a test could not
fail, say so in the commit message. Several production bugs here were invisible to green suites
(PGlite hid a postgres.js jsonb encoding bug; a `.gitignore` pattern hid a route from git), which is
why the e2e also runs against hosted Supabase and deploys come from a clean worktree.

---

## Operations

### Migrations
New files go in `supabase/migrations/` (timestamp prefix, additive, idempotent) with a test in
`supabase/test/`. Apply to hosted Supabase over the session connection (port 5432) **before** deploying
code that depends on them. After changing shared seed data, regenerate `seed.sql` with
`pnpm --filter @groundtruth/supabase seed:gen`.

### Rotating the admin password
```bash
cd apps/web
npx tsx --env-file=.env scripts/rotate-admin-password.ts          # random, printed once
ADMIN_PASSWORD=<16+ chars> npx tsx --env-file=.env scripts/rotate-admin-password.ts
```
It needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, only touches
`researcher@groundtruth.dev`, and writes nothing to disk. Store the result privately; never commit it.

### Account administration
Dashboard → **Admin → Users** (admins only): grant/revoke researcher, grant admin, suspend/unsuspend,
and issue a temporary password (shown once, never emailed; the user changes it under Account). Users
reset their own password with **Forgot password?**: an emailed 6-digit code (or link) via Supabase +
Resend.

### Revoking access
- **Suspend** the account in Admin → Users. Every API call and every RLS-protected read checks the
  profile, so it takes effect on the next request even though the user's JWT has not expired.
- A completed **password reset** signs the account out on every device (Supabase global logout).
- **Leaked server secret:** rotate it at the provider (xAI key, Supabase service role / DB password,
  `CRON_SECRET`, Vercel token), update the Vercel env vars, redeploy.
- Researcher access revoked by an admin sticks: the user cannot self-serve it back.

### Retention cron
`vercel.json` runs `GET /api/cron/retention` daily at 07:00 UTC with `Authorization: Bearer $CRON_SECRET`.
It deletes photos of rejected submissions older than `REJECTED_MEDIA_RETENTION_DAYS` (default 30; the
row stays with `media_purged_at`) and prunes old rate-limit windows. Idempotent and batch-limited;
`POST` with the same header runs it manually.

### Rate limits
DB-backed fixed windows (`lib/rateLimit.ts`, table `rate_limits`), because in-memory counters don't
work on serverless. Per hour: sign-ups 5/IP, capture sessions 30/user, submissions 20/user, protocol
drafts 10, red-team runs 20, password changes 10, reset emails 10/IP and 5/address, reset code attempts
30/IP and 10/address. Over the limit → `429 RATE_LIMITED`.

### Demo data
- `pnpm demo:reset` resets to the demo state. With `LOCAL_BACKEND=1` it wipes `apps/web/.local`. **Without
  it, it wipes the app tables of whatever `DATABASE_URL` points at**, hosted included. Think first.
- `POST /api/demo/spawn-event` (DEMO_MODE, researcher): the dashboard's spawn card on **Bounties**.
- `seed:open-data` rows are marked `verifier = none` and are never exported or published;
  `--reset` removes them.
- `pnpm --filter @groundtruth/web generate:examples` pre-generates Grok Imagine example shots.

---

## Security and privacy model

**Accounts and roles.** Every user has an email + password account; anonymous callers get
`401 ACCOUNT_REQUIRED`. One account can be both contributor and researcher: researcher access is
self-serve (organization + purpose + terms) and admin-revocable. Admin is a separate flag. Suspended
accounts get `403 ACCOUNT_SUSPENDED`.

**API connection.** The API connects to Postgres with a service-level `DATABASE_URL` that bypasses RLS,
so **every route does its own authorization**: bearer token → Supabase `auth.getUser` → profile flags.
Dev tokens (`dev.<uuid>`) are accepted only with `LOCAL_BACKEND=1` and refused otherwise.

**RLS** still guards direct client reads (realtime, storage): owners read their own rows and photos,
researchers read what they manage, and restrictive policies give suspended or anonymous users nothing.

**Public vs private.**

| Public (no login) | Private |
|---|---|
| `/data`, `/api/public/datasets`: coarsened rows of quality-tier observations, CC BY 4.0 | Raw photos (private `observations` bucket, signed URLs only; researchers get face/plate-redacted copies, originals are admin + contributor only) |
| Aggregate coverage | Exact location and time, device, trust, free text |
| | Researcher exports, review queue, red-team runs |

**Synthetic-media guard.** Generated assets live in a separate `synthetic` bucket and are tracked in
`synthetic_media`. The API refuses submission media outside `observations/`, and a DB trigger
(`guard_submission_media`) refuses it again. Red-team runs deliberately push fakes through the pipeline
but write to `redteam_runs`, never `submissions`. Mock-decided and seed rows are never exported or
published.

**Capture integrity.** No photo-library import exists in the app. The shutter unlocks only on the
server's `gate_passed`; there is no degraded offline unlock.

**Data rights.** Account → *Download my data* (`GET /api/me/export`: profile, sessions, submissions with
signed photo URLs, ledger). *Delete account* (`DELETE /api/me`): photos, profile, wallet and sessions
are deleted; accepted observations already in the open dataset stay, de-identified (reassigned to a
deleted-user placeholder). Rejected photos expire after 30 days.

**Secrets.** Nothing secret is committed: no keys, no tokens, no passwords. The admin password is stored
privately and rotated with the script above.

---

## Known limitations

- **Model-only AI-image detection is weak.** grok-4.7 did not flag a Grok Imagine fake by itself. What
  catches it is the C2PA/IPTC label check and the challenge burst. C2PA labels disappear when a fake is
  re-encoded or re-photographed off a screen; for that case the capture gate (screen/print flag) and
  burst parallax are the defense. A physically staged scene can pass visual checks (PRD §9.4).
- **Verification takes ~40 s** (grok-4.7 at medium effort), over the PRD's 25 s target. Measured: the
  faster settings (low effort, shorter evidence) let Imagine fakes through, so they were not shipped.
- **Redaction boxes are approximate** (see above): large blurred areas, possible misses.
- **Depth values are estimates with confidence,** not measurements.
- **Free iOS signing expires every 7 days;** no TestFlight/App Store build.
- **Payouts are simulated** (wallet ledger only).
- **Not built or not wired to a UI:** the voice onboarding interview (a form exists instead); Opportunity
  Radar (`POST /api/radar/scan`, API only); briefing video (`/api/bounties/:id/briefing-video` generates
  a clip but no screen plays it yet); local notifications.
- **Accept-rate targets are unmeasured** until real positive fixtures are added (`test/fixtures`).
- `LOCAL_BACKEND=1` has no realtime; clients poll.
