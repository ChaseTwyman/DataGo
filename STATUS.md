# GroundTruth — Status

_Last updated: production on Vercel (https://groundtruth-two-snowy.vercel.app), open data live, mobile redesign landed. Next: Release build on the iPhone pointed at Vercel._

## Production
- **Web + API:** https://groundtruth-two-snowy.vercel.app (Vercel project `groundtruth`, team `panoptic-pigskin`, Hobby, region iad1). Supabase = hosted DB/Auth/Storage/Realtime. Nothing needs to run on a laptop.
- **Open data (no login):** https://groundtruth-two-snowy.vercel.app/data · API `/api/public/datasets[/street-flood-depth?format=csv|geojson|json|dictionary]`. CC BY 4.0, privacy-coarsened (cell centers, 5-min time, per-dataset pseudonyms, no photos). 41 rows now (40 flagged `is_demo_seed`; remove with `LOCAL_BACKEND=0 DEMO_MODE=1 npx tsx --env-file=.env scripts/seed-open-data.ts --reset` in apps/web).
- **Deploy:** always from a clean `git worktree` of origin/main (never the working copy): `VERCEL_TOKEN=… npx vercel deploy --prod --yes --scope panoptic-pigskin`. Env vars live in the Vercel project (LOCAL_BACKEND=0, MOCK_GROK=0, DEMO_MODE=1).
- **Measured on Vercel (real Grok):** voice token 1.2 s; frame check 1.3–1.4 s; Imagine ~16 s; grok-4.7 verification 41 s at `reasoning_effort: medium` (was 89 s at default "high", and 120 s → error before removing the SDK's hidden retry); full red-team run 58 s, caught (`CHALLENGE_FAILED` + `C2PA_AI_GENERATED`).

## Bugs found by going to production (all fixed)
- `.gitignore` `coverage/` hid `app/api/bounties/[id]/coverage/route.ts` from git: every clone lacked the endpoint while local checks passed (b2cd456).
- postgres.js double-encoded jsonb params (PGlite doesn't) → "media must be an array" on hosted DB (d9c27f4).
- Hobby maxDuration cap (300 s) rejected the deploy (f65bdb0); red-team 120 s limit too low (4d29cf5).
- Verification: 12 MP frames + 60 s timeout × SDK retry → 120 s error (4615e96); reasoning effort high → 89 s (e31985f).
- iOS 27 SDK requires UIScene life cycle (1092a35); Hermes/Expo TextDecoder lacks UTF-16 so h3-js broke every route (50bbc95); ATS ignored NSAllowsArbitraryLoads next to NSAllowsLocalNetworking (8013794).

## Milestones
| # | Milestone | State |
|---|---|---|
| M0 | Foundations and contracts | ✅ done |
| M0.5 | Voice spike | ✅ code done · ⏳ device acceptance (latency, barge-in) |
| M1 | Skeleton loop (mock AI) | ✅ done — e2e script 19/19 in local mode |
| M2 | Capture gate + challenge | ✅ code done · ⏳ device |
| M3 | Verification pipeline | ✅ done — real Grok verified on Vercel |
| M4 | Voice field guide | ✅ code done · ⏳ device |
| M5 | Economy + data | ✅ done |
| M6 | Imagine + red team | ✅ done — real Grok on Vercel, C2PA check |
| M7 | P1 | ◑ backend for Radar, Protocol Studio, briefing video done; voice onboarding interview not built (form fallback exists); no UI for Radar/Studio |
| M8 | Demo readiness | ◑ spawn-event, demo-reset, e2e, eval done · README.md + DEMO.md not written |

## Verification evidence
- `pnpm check` (root): typecheck + lint + tests green — shared 51, supabase 13, web 95, mobile 99 = **258 tests**.
- Web e2e (`LOCAL_BACKEND=1 MOCK_GROK=1 DEMO_MODE=1`, `next dev`): 19/19 steps — accepted (conf 0.831), $11.60 paid + wallet credited, `screen_recapture` flagged, coverage 19 cells, CSV (31 cols) + GeoJSON, red-team `ai_generated` and `recycled` both caught. Same loop runs in vitest (`test/api.loop.test.ts`).
- Mobile smoke (`pnpm --filter @groundtruth/mobile smoke`): app's own API client + gate reducer against the local API → accepted, 1160¢, wallet credited.
- `next build` compiles all 27 routes + dashboard pages. Mobile: expo-doctor 21/21, Android prebuild OK, `expo export` bundles iOS + Android.
- Dashboard pages browser-checked against the local API.
- Independent reviewers per track; all confirmed findings fixed (web: review race, CSV formula injection, hard-coded dev signing secret, error-text leak, example-image ownership; mobile: degraded gate could unlock over a flagged screen, voice session stalls).
- Hosted Supabase: migrations + seed applied, researcher login, anonymous sign-in and RLS reads verified via REST.

## Real vs mocked / unverified
- **Hosted Supabase end to end** (auth, Storage signed uploads, DB, pipeline, wallet, export, red team): e2e **19/19** with MOCK_GROK=1 after fixing a postgres.js jsonb double-encoding bug that PGlite hid (d9c27f4).
- **Real Grok, verified once each** (Supabase mode):
  - voice token: 129 ms; `client_secrets` returns `{ value, expires_at }`; phone gets a wss URL.
  - frame check (grok-4.20): 1.3 s; a blank grey frame correctly returned no elements visible, not green.
  - Imagine image: 13.6 s. Verification (grok-4.7): **31.6 s** (6.4k in / 2.2k out tokens) — over the PRD's 25 s target.
- **AI-fake detection:** the real grok-4.7 did **not** flag a Grok Imagine fake as AI-generated. Fix (ea9ae70): Grok Imagine embeds a C2PA manifest (`softwareAgent: Grok Imagine`, `trainedAlgorithmicMedia`); the authenticity stage now reads C2PA/IPTC labels and hard-fails with `C2PA_AI_GENERATED`, independent of the model. Live red-team run now: `CHALLENGE_FAILED` + `C2PA_AI_GENERATED` (28 s). Labels vanish on re-encode or when a fake is photographed off a screen, so for that attack the capture gate (screen/print flag) and burst parallax remain the defense; model-only AI detection stays weak — don't claim it in the demo.
- **Still unverified:** realtime from the apps; everything device-only (audio echo/latency, camera, DeviceMotion, upload from the phone, pod install on macOS).

## Running it
- Local, no Supabase: PowerShell `$env:LOCAL_BACKEND="1"; pnpm dev:web` (add `$env:MOCK_GROK="1"` for no xAI calls). Dashboard login: "Continue as demo researcher". Clients poll instead of realtime.
- Supabase mode: `pnpm dev:web` with `LOCAL_BACKEND=0` and a working `DATABASE_URL`. Researcher login `researcher@groundtruth.dev` / `groundtruth-demo` (change before any public demo — it is in the repo).
- E2E: `BASE_URL=http://localhost:3000 pnpm --filter @groundtruth/web e2e:mock`.
- Stop `next dev` before `demo:reset` / `generate:examples` in local mode (PGlite is single-process). Never run `demo:reset` against the hosted DB without meaning to — it wipes data.

## Known issues / decisions
- Decision rules beyond the PRD: weak (<0.8) authenticity suspicion, edited/composited, velocity, impossible travel → capped at `needs_review`; missing element / protocol score below minimum → retryable reject; `OUTSIDE_WINDOW` is a hard fail; identical burst frames → `CHALLENGE_FAILED` even if the model is fooled.
- Protocol-reject retry opens a new capture session (one upload slot set + one submission per session).
- VisionCamera v5 (v4 incompatible with SDK 57): EXIF is not exposed to JS; it stays in the JPEG bytes.
- expo-notifications removed (unused; it adds a push entitlement a free Apple ID can't sign). Local notifications (P1) would need it back with the entitlement stripped.
- Ephemeral voice token response shape is undocumented; parser accepts common variants and logs keys once.
- Commit `06f2f23` also contains some web-API files swept in from a shared git index; content intact, history left as-is.

## Human TODOs
- [x] Hosted Supabase project; anonymous sign-ins on; schema + seed applied.
- [x] `XAI_API_KEY` added and verified.
- [x] `apps/mobile/.env` filled (API URL `http://10.90.48.161:3000`, Supabase URL + anon key).
- [x] `DATABASE_URL` password fixed; API connects to hosted DB.
- [x] Mac: Xcode 27 + Apple ID, Node, pnpm, CocoaPods, clone, iPhone Developer Mode. App runs on the iOS 27 simulator.
- [x] ~~Same Wi-Fi / tunnels~~ — obsolete: API is on Vercel.
- [ ] Mac: set EXPO_PUBLIC_API_BASE_URL=https://groundtruth-two-snowy.vercel.app, then Release build to the iPhone.
- [ ] ~20 real test photos in `apps/web/test/fixtures` (see its README).

## Device test steps
Build on the Mac: `git pull && pnpm install && cd apps/mobile && IOS_BUNDLE_ID=com.<yourname>.groundtruth npx expo run:ios --device` (Personal Team in Xcode if asked; trust the profile on the phone). If pod install fails on module resolution: `nodeLinker: hoisted` in `pnpm-workspace.yaml`, `pnpm install`, retry. Web server runs on the Windows laptop (`pnpm dev:web`).

1. **Voice spike**: Map → "🎙 Voice test" → Connect. Say "hello" → reply ≲1.5 s (latency readout green < 1500 ms). Talk over the reply → playback stops immediately. Note any unknown event types shown.
2. **Capture gate**: in the bounty area (or after spawn-event at your location) → For you → bounty → Start capture. Guide asks the safety question → "yes". Checklist rows go green with a haptic tick; shutter shows a lock + the top missing item until 2 consecutive all-green checks.
3. **Screen flagging**: point at a laptop showing a flood photo → "Real scene" row red, shutter stays locked, warning haptic. (Also via Wallet → Developer → `screen_recapture` mock variant.)
4. **Full loop**: say "capture" → challenge shown, 1.8 s countdown, 3-photo burst → answer both field questions by voice or tap → Submit → result checklist animates → accepted amount counts up → wallet credit. Dashboard shows it live on the map + dataset.
5. **Unsafe path**: say "I don't feel safe" → guide thanks you, session ends, "no penalty".
6. **Degraded mode**: stop the API during framing → after 10 s the gate unlocks on device checks only, shows a degraded note, submits with `gate.degraded = true`.

Record latency and any issues here after the first run.
