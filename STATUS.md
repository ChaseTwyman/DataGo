# GroundTruth — Status

_Last updated: all three build tracks complete (web API, dashboard, mobile). Next: first device run._

## Milestones
| # | Milestone | State |
|---|---|---|
| M0 | Foundations and contracts | ✅ done |
| M0.5 | Voice spike | ✅ code done · ⏳ device acceptance (latency, barge-in) |
| M1 | Skeleton loop (mock AI) | ✅ done — e2e script 19/19 in local mode |
| M2 | Capture gate + challenge | ✅ code done · ⏳ device |
| M3 | Verification pipeline | ✅ done (mock-verified; real Grok untested) |
| M4 | Voice field guide | ✅ code done · ⏳ device |
| M5 | Economy + data | ✅ done |
| M6 | Imagine + red team | ✅ done (mock-verified) |
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
- **Real Grok calls**: key verified (models endpoint + one tiny Responses call), but the vision/verification/imagine/voice paths have only run in mock mode.
- **Hosted DB from the API**: blocked — `DATABASE_URL` password rejected (28P01) on pooler and direct host. Schema is in place (applied earlier with a working password).
- **Supabase Storage** signed uploads and **realtime** from the apps: untested.
- **Device-only**: audio (echo, latency, `onBufferEnded`), camera snapshot/photo, DeviceMotion axes, upload, pod install on macOS.

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
- [ ] **Fix `DATABASE_URL` password** (reset to letters+digits in Supabase → paste into `apps/web/.env`).
- [ ] Mac: Xcode + Apple ID, Node 24, pnpm, `brew install cocoapods watchman`, clone, copy `apps/mobile/.env` (AirDrop/USB), iPhone plugged in + Developer Mode on.
- [ ] Same Wi-Fi (or hotspot) for Windows laptop, Mac, iPhone. Allow Node through Windows Firewall (Private).
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
