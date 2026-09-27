# GroundTruth — Status

_Last updated 2026-09-26, production at `d56ec63`. Feature-complete for the hackathon and deployed.
Remaining work is human: iPhone Release rebuild + device tests, real eval photos, funding the sponsor
pool, and the 2D-shift anti-fake check._

See `README.md` (setup, architecture, operations, security) and `DEMO.md` (checklists, 3-minute
script, recovery).

## Production
- **Web + API:** https://groundtruth-two-snowy.vercel.app — Vercel project `groundtruth` (team
  `panoptic-pigskin`, Hobby, iad1). Hosted Supabase for DB/Auth/Storage/Realtime. Nothing runs on a
  laptop.
- **Database:** migrations **0001–0010** applied (0009 redaction, 0010 missions). The API uses
  node-postgres on the transaction pooler (6543).
- **Accounts:** required for everyone; anonymous sign-in off in Supabase and refused by the API
  (`ACCOUNT_REQUIRED`). Researcher is self-serve and admin-revocable; admins can suspend and issue
  temporary passwords. Admin `researcher@groundtruth.dev`, password stored privately, never in the repo.
- **Password reset:** emailed 6-digit code via Resend (domain `panopticpigskin.tech` verified, sender
  `no-reply@panopticpigskin.tech`); a completed reset signs out every device.
- **Open data:** `/data` + `/api/public/datasets`, CC BY 4.0, privacy-coarsened, no photos. Currently
  **0 public rows**: only demo placeholder rows (`verifier = none`) and one rejected test capture
  exist, and neither publishes.
- **Economy:** the general sponsor pool has **$0 available** (existing bounties were migrated as fully
  funded), so new researcher requests stay `pending_funding` until an admin records a contribution.
- **Daily cron** (`/api/cron/retention`, 07:00 UTC): rejected-media retention (30 days), rate-limit
  pruning, Grokbot cache pruning, allocation run, up to 5 redaction retries.
- **Kill switch:** `GROKBOT_DISABLED=1` → every Grokbot and Ask-the-data endpoint returns 501; core
  flows unaffected.

## What is shipped
| Area | State |
|---|---|
| Capture loop: bounties, briefing, voice guide, server-authoritative gate, challenge burst | ✅ live · ⏳ device test of the current build |
| Verification pipeline (8 stages, `decide()`, verifier provenance, C2PA/IPTC check) | ✅ real Grok on Vercel |
| Economy: sponsor pool, allocation engine, server-only pricing with `price_reasons` | ✅ live |
| Grokbot: narration/explain, why-this-price, For-you match, request status, reviewer brief, Studio self-check, Radar drafts, sponsor impact | ✅ live, real Grok |
| Ask the data (dashboard `/ask`, public panel on `/data`) | ✅ live, real Grok |
| Revisit missions (+30/+60/+120 min, 10-min first dibs, paid from the request allocation) + recession sparklines | ✅ live |
| Impact cards (no photo / precise location / time of day / ids) | ✅ live · ⏳ on device |
| Offline upload queue (gate still online; 90-min server grace; per-account) | ✅ code + server · ⏳ on device |
| Face/plate redaction for researcher-visible photos | ✅ live; backfill ran (1 submission, 3 frames) |
| Accounts, roles, admin, data export/deletion, rate limits, retention | ✅ live |
| Protocol Studio, Opportunity Radar, briefing clip (dashboard) | ✅ live (phone doesn't play briefing clips) |
| Mission-control design system across every web page | ✅ live |
| Voice onboarding interview | ✗ not built (form onboarding instead) |

## Measured (production, real Grok)
- Voice token ~1.2 s · frame check ~1.3 s · relevance ~2 s · Imagine ~16 s · red-team run ~58 s.
- **Verification ~45 s end to end** (grok-4.7 ~41 s at medium). The PRD's **25 s target was not met**.
- Grokbot: narration ~4 s, explain 0.2–4 s, reviewer brief 7–9 s, status 3 s, price-why 2.5 s,
  sponsor impact 2.3 s, self-check 3 s.
- Ask the data: valid plans in 3–4.5 s; an injection question refused in 75 ms with no model call.
- Pricing: opening a capture session ~410 ms; 36/36 concurrent nearby/coverage requests 200 in
  0.3–1.9 s after the driver fix.

## Tests
- Clean-worktree `pnpm check` at `d56ec63`: shared **105**, mobile **260**, supabase **45**, web **488**
  (+1 skipped).
- Live production checks: accounts smoke 21/21 on first run (re-runs now hit the 5/hour sign-up limit
  by design); Grokbot and Ask-the-data endpoints exercised with real Grok (timings above).
- Independent reviewers on every track.

## Known limitations
- **Fake-parallax gap:** a burst made of shifted crops of one AI image (C2PA stripped) is caught by
  grok-4.7 only some of the time. Proposed fix, **not built**: a deterministic check that burst frames
  differ by a pure 2D shift/crop.
- **Model-only AI-image detection is weak;** C2PA provenance, the live gate (screen/print flag) and
  burst parallax do the catching. C2PA disappears when a fake is re-photographed off a screen.
- **Redaction:** fast-model boxes were 4–10 % off, so boxes are expanded generously (may blur depth
  references like the tire under a plate); missed detections are possible; admins keep originals.
- **Grokbot citations** prove a fact exists, not that it entails the sentence.
- Positive-accept rate is unmeasured until real positive fixtures are added.
- Free iOS signing expires every 7 days; payouts are simulated.
- `supabase/config.toml` (local CLI) still enables anonymous sign-ins; hosted has them off and the API
  refuses them anyway.
- Per-IP rate limits trust Vercel's forwarded-for headers; per-user/per-email limits don't.
- `GROKBOT_DISABLED`, `GROK_COPILOT_MODEL`, `IMPACT_AI_DAILY_CAP` are read by code but are not in
  `apps/web/.env.example` (all optional; documented in README).

## Decisions and incidents (short)
- **Server-authoritative capture gate** (after the "vitamin-water" incident: a bottle on carpet
  reached review through a degraded phone-side unlock with 0 real frame checks). The shutter unlocks
  only after 2 consecutive real all-green frame checks; otherwise `GATE_NOT_PASSED`, never paid. Seed
  and mock rows that had reached the public dataset were deleted; mock mode is refused on a real DB.
- **Verification speed vs. safety:** `low` reasoning effort and terse prompts with output caps cut
  latency but accepted pseudo-parallax Imagine fakes, so they were rejected. Only concurrency shipped
  (grok-4.7 starts alongside relevance; ~2 s). Latency tracks reasoning tokens plus large server-side
  variance; hedged duplicate requests were not built because the fast answers were the wrong ones.
- **DB driver incident (fixed, 0c38473):** postgres.js pipelined queries that Supavisor's transaction
  pooler can't handle (requests hung ~150 s); session mode (5432) exhausted its 15-client pool. Now
  node-postgres, never pipelining, 30 s statement timeout, back on 6543.
- **Storage hole closed by 0009:** any self-serve researcher could read every original photo from
  storage. Now non-admin researchers read only `*.redacted.jpg` from their own requests.
- **Grokbot stage labels** come from stored stage status: a live run showed the model calling
  timeouts "inauthentic/strong" (fixed e926621).
- **Genuine revisits** of the same spot go to review rather than being rejected as `DUPLICATE`
  (19db895).
- **Deploys** come only from a clean, Vercel-linked worktree of origin/main, after migrations. The
  working copy once hid a route missing from git behind `.gitignore`; an unlinked folder once created a
  stray Vercel project.
- **Local tooling:** something in the local Claude tooling has written stray `$L`/`$WT` files and once
  truncated source files in the OneDrive working copy; committed history was intact.

## Human TODOs
- [ ] **Mac: Release rebuild + device tests** (steps below). JS-only changes since the last native
      build; run `expo prebuild --clean` if the icon/splash native build was never done. Rebuild within
      7 days of the demo.
- [ ] **Real test photos for eval:** positives (tub + ruler, puddles), negatives (random objects, a
      screen) → `apps/web/test/fixtures` → `pnpm eval:verification`.
- [ ] **Record a sponsor contribution** (Admin → Funding) so new requests fund.
- [ ] **Build the deterministic 2D-shift anti-fake check** for burst frames.
- [ ] **After the hackathon:** revoke the Vercel and Supabase access tokens; move the admin password
      into a password manager and delete the local plaintext copy.
- [ ] **Delete leftover worktree folders:** `$WT` (repo root, `apps/web`) and the Temp worktrees
      (`C:\Users\sumedh\AppData\Local\Temp\{gtm,gtx,gta,gtd,gtr,gpd,…}`), then `git worktree prune`.

## Phone build (Mac)
```
cd ~/DataGo && git restore pnpm-lock.yaml apps/mobile/tsconfig.json 2>/dev/null; git pull && pnpm install
cd apps/mobile   # .env: EXPO_PUBLIC_API_BASE_URL=https://groundtruth-two-snowy.vercel.app (+ Supabase URL, anon key)
IOS_BUNDLE_ID=com.<name>.groundtruth npx expo prebuild --platform ios --clean
IOS_BUNDLE_ID=com.<name>.groundtruth npx expo run:ios --device "<iPhone name>" --configuration Release
```

## Device test steps
1. **Accounts:** create account → onboarding → map. Sign out/in. Forgot password → emailed code.
2. **Voice (dev builds only; hidden in Release):** voice test screen → "hello" → reply ≲1.5 s; talk
   over it → stops.
3. **Capture gate:** For you → bounty → Why this price → Start capture → safety question → rows go
   green; shutter unlocks only after "Scene verified 2/2".
4. **Screen flagging:** a laptop showing a flood photo → "Real scene" red, shutter stays locked.
5. **Can't verify:** turn off Wi-Fi/cellular during framing → "CAN'T VERIFY SCENE", shutter stays
   locked, recovers when back online.
6. **Offline queue:** pass the gate, take the burst, then go offline before submit → the capture is
   queued; back online → it sends and verifies. Sign in as another account → the queued capture is
   not shown.
7. **Full loop:** challenge → burst → field notes → verification (~45 s) with Grokbot narration →
   accepted → wallet → Share impact card (check: no photo, no exact place/time). Dashboard shows it
   live; `/data` shows it once accepted with confidence ≥ 0.75.
8. **Revisit mission:** after an accepted flood reading, a mission appears (due +30 min, first dibs
   10 min) on For you / map; fill it and check the bounty page's recession sparkline.
9. **Off-topic:** capture something unrelated → rejected `OFF_TOPIC` with "Point the camera at: …".
10. **Cashew test:** "Cashew package label test" bounty (3 km around Georgia Tech) — box + label +
    weight + a pen/phone for scale.
11. **Account data:** Account → Download my data; Delete account (type DELETE).
