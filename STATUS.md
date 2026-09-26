# GroundTruth — Status

_Last updated 2026-09-26: feature-complete for the hackathon and deployed. Accounts, password reset, verification hardening, open data, error handling all live. Remaining: device run on the iPhone (Release build), Resend DNS for reset emails, positive eval fixtures, Radar/briefing-video dashboard UI (in progress)._

See `README.md` (setup, architecture, operations, security) and `DEMO.md` (checklists, 3-minute script, recovery).

## Production
- **Web + API:** https://groundtruth-two-snowy.vercel.app — Vercel project `groundtruth` (team `panoptic-pigskin`, Hobby, iad1). Hosted Supabase for DB/Auth/Storage/Realtime. Nothing runs on a laptop.
- **Open data (no login):** `/data`, `/api/public/datasets[/<slug>?format=csv|geojson|json|dictionary]`. CC BY 4.0, privacy-coarsened, no photos. Only human-approved or model-accepted (confidence ≥ 0.75) rows (`quality_tier`). Currently **0 rows** — all earlier seed/mock rows were deleted; real captures will populate it.
- **Accounts:** required for everyone (email + password). Sign-up is server-side and pre-confirmed (no verification email). One account can be contributor and researcher; researcher is self-serve, admins can revoke/suspend/issue temporary passwords (Admin → Users). Anonymous sign-ins are disabled in Supabase and refused by the API (`ACCOUNT_REQUIRED`).
- **Password reset:** "Forgot password?" on web and phone → emailed 6-digit code (15 min) or a `token_hash` link → new password → all sessions revoked. Supabase custom SMTP = Resend, sender `no-reply@panopticpigskin.tech`. **Blocked on DNS:** Resend domain `panopticpigskin.tech` needs CNAMEs `send → send.forge.rmta.net` and `rsend → rsend.forge.rmta.net` (DKIM already present). Until verified, reset emails don't send (the API still returns 202).
- **Admin:** `researcher@groundtruth.dev`; password rotated, never in the repo (was committed earlier — the old one is dead). Rotate with `apps/web/scripts/rotate-admin-password.ts`.
- **Deploy:** from a clean `git worktree` of origin/main only; apply migrations to hosted Supabase first. Vercel env includes CRON_SECRET, NEXT_PUBLIC_SITE_URL, REJECTED_MEDIA_RETENTION_DAYS=30, GROK_* models, LOCAL_BACKEND=0, MOCK_GROK=0, DEMO_MODE=1. Daily retention cron (`/api/cron/retention`) deletes rejected photos after 30 days.
- **Measured on Vercel (real Grok):** voice token ~1.2 s; frame check ~1.3 s; relevance ~2 s; Imagine ~16 s; grok-4.7 verification ~41 s (reasoning_effort medium); red-team run ~58 s.

## Grokbot — live
- One role-scoped operator across the loop (contracts: `packages/shared/src/contracts/grokbot.ts`; server `apps/web/lib/grokbot/`, routes `/api/grokbot/**`; migration 0008 `grokbot_cache` + `protocols.self_check`). Laws stay server-side (pricing, capture gate, never auto-accept, permissions). Kill switch: `GROKBOT_DISABLED=1` in Vercel → 501 everywhere.
- Features: verification companion (narrated stages + explain; phone speaks scripted lines only), Studio self-check (example image through the live frame check before publish; never blocks), For-you match reasons (match_cache from profile), "why this price", pool-aware Radar drafts, request status explanations, reviewer brief (evidence + uncertainty + injection flags, **no verdict**), sponsor impact (admin + public aggregates).
- Guardrails: contributors always get deterministic templates (no model text); model lines must cite case-file facts or are dropped; verdict-like lines dropped; stage evidence labelled from stored status (live run showed the model calling timeouts "inauthentic/strong" — fixed e926621); contributor text is untrusted, injection flagged. Known limit: citations prove a fact exists, not that it entails the sentence.
- Live real-Grok (production): narration 4 s, explain 0.2–4 s, brief 7–9 s, status 3 s, price-why 2.5 s, sponsor impact 2.3 s, self-check 3 s (cashew protocol: all elements "ok"; it flagged the AI example image as looking like a screen/print). Not yet live-verified: match refresh with real profiles; narration on a device.

## Ask the data (Grok copilot) — code complete, not yet deployed
- `POST /api/copilot/ask` (researchers; optional `bounty_id` of their own request unlocks "cells under target") and `POST /api/public/copilot/ask` (no login). UI: dashboard `/ask` (Research → Ask the data) and an Ask section on `/data`. Contracts: `packages/shared/src/contracts/copilot.ts`; server `apps/web/lib/copilot/`.
- The model only fills a strict query plan (time window, near point/radius, bounty, quality tier, field filters, group by field/cell/hour/day, count/min/max/mean/median/p90, coverage, sort, limit ≤ 500, chart). The server validates every name against the dataset's public columns and runs parameterized SQL over the same coarsened rows `/api/public/datasets` serves (passed as one jsonb parameter; contributor ids stripped). Answer text reuses Grokbot grounding (invented numbers dropped); methods note + "How I answered" are deterministic.
- Plan cached by normalized question + dataset version + scope; results always recomputed. Limits: researcher 120/h; public 20/h/IP + 400/h site-wide. `GROKBOT_DISABLED=1` switches it off. Model: `GROK_COPILOT_MODEL` or the fast model.
- **Not yet real-Grok verified** (no key in the build session): after deploy, ask 2 example questions on `/data` (≤ 4 model calls) and record latency + whether the plans validate.

## Economy (sponsor pool + platform pricing) — live
- Sponsors fund a pool (Admin → Funding: sponsors, contributions with optional earmarks, append-only ledger with reversals; public totals at `/funding`). Researchers submit **data requests** with no prices/budgets; the allocation engine funds them (earmarks first, then general pool; caps per request/researcher) or leaves them `pending_funding` with a reason. Money is simulated.
- Server-only pricing engine (`apps/web/lib/pricing/`): base × scarcity × urgency × demand × supply × pacing, clamped per protocol and fitted so expected payouts never exceed the allocation. Clients get `price` + `surge` + `price_reasons` only. Payout = locked quote (15 min) × quality multiplier.
- The general pool currently has **$0 available** (existing bounties were migrated as fully funded), so new researcher requests stay pending until an admin records a contribution.
- Live check: nearby shows reasons like "Few readings here · Event is recent · High demand"; opening a capture session 410 ms.

## Production incident: DB driver (fixed)
- After the pricing engine shipped, /nearby and /coverage intermittently hung ~150 s or 500'd with statement timeouts. Cause (caught live in `pg_stat_activity`: `active / ClientRead`): postgres.js pipelines queries when more are in flight than connections, and Supabase's transaction pooler (6543) can't handle pipelined messages. Session pooler (5432) was tried and rejected (15-client limit → EMAXCONNSESSION). Fix 0c38473: node-postgres (`pg`) Pool, never pipelines, 30 s statement timeout. Production back on 6543; 36/36 concurrent requests 200, 0.3–1.9 s.

## Web redesign — live
- One design system (`apps/web/components/ds`): black/hairline/Barlow condensed caps, one accent, dark map; every page restyled (login split layout, dashboard, studio, radar, funding, account, admin, /data). Contrast asserted by tests (≥ 4.5:1).

## Verification design (after the vitamin-water incident)
- Incident: a bottle on carpet reached needs_review on a flood bounty (phone gate unlocked in a "degraded" fallback with 0 real frame checks; grok-4.7 timed out; a human rejected it). Separately, seed/mock rows had reached the public dataset — deleted.
- **Decisions (supersede BUILD_PROMPT M2's degraded fallback):** the shutter unlocks only on the server's `gate_passed` (2 consecutive real all-green frame checks); otherwise "CAN'T VERIFY SCENE" + backoff retry. Sessions that never passed → `GATE_NOT_PASSED` → review, never paid.
- Pipeline: session integrity → **relevance** (fast model, `OFF_TOPIC`) → challenge → protocol (+ extraction sanity rules) → authenticity (+ C2PA/IPTC AI-provenance hard fail) → context → duplicates → corroboration → `decide()`. `submissions.verifier` = model|mock|human|none; MOCK_GROK refused on a real DB; mock/seed rows never exported or published.
- Real-Grok eval: `negative/vitamin-water-bottle` → rejected `OFF_TOPIC` in 2.1 s (0.90). A Grok Imagine fake → `CHALLENGE_FAILED` + `C2PA_AI_GENERATED`. **Not yet proven:** real positive captures being accepted — add tub+ruler / puddle fixtures and run `pnpm eval:verification`.
- Honest limit: model-only AI-image detection is weak (grok-4.7 did not flag an Imagine fake); C2PA labels vanish when a fake is re-photographed, so the gate's screen/print check and burst parallax cover that case.

## Milestones
| # | Milestone | State |
|---|---|---|
| M0 | Foundations and contracts | ✅ |
| M0.5 | Voice spike | ✅ code · ⏳ device acceptance (latency, barge-in) |
| M1 | Skeleton loop | ✅ |
| M2 | Capture gate + challenge | ✅ code (server-authoritative gate) · ⏳ device |
| M3 | Verification pipeline | ✅ real Grok on Vercel |
| M4 | Voice field guide | ✅ code · ⏳ device |
| M5 | Economy + data | ✅ |
| M6 | Imagine + red team | ✅ real Grok, C2PA check |
| M7 | P1 | ◑ Protocol Studio UI ✅ (`/studio`; cashew-box protocol drafted/published live); Radar + briefing-video dashboard UI in progress (backends done; phone doesn't play briefing clips); voice onboarding interview not built (form onboarding exists) |
| M8 | Demo readiness | ✅ README.md, DEMO.md, spawn-event, eval, e2e |
| — | Accounts, roles, admin, data rights, rate limits, retention | ✅ live; 21/21 live account checks |
| — | Password reset by email code | ✅ code + Supabase config live · ⏳ Resend DNS |
| — | "No random errors" pass | ✅ forward-compatible parsing, friendly errors, error boundaries |

## Verification evidence
- Clean-checkout `pnpm check` at f203328: shared 86, mobile 219, supabase 33, web 241 (+1 skipped) = **579 tests**; `next build` OK; `expo export --platform ios` OK (main tree).
- Live production checks: accounts smoke 21/21 on first run (sign-up, duplicate email, sign-in, /me, researcher self-serve, admin list/revoke/reset, revoked user can't re-enable, anonymous refused, export, delete, open data, cron auth). Re-runs now hit the sign-up rate limit (5/hour/IP) — expected.
- Independent reviewers on every track; notable fixes: degraded gate unlocking over a flagged screen, account deletion could remove another user's photos, reset sign-out failure swallowed, error-text leaks.
- Going-to-production bugs fixed: `.gitignore` hid the coverage route; postgres.js double-encoded jsonb; Vercel Hobby maxDuration; verification timeouts (frame downscaling, no SDK retry, reasoning medium); iOS 27 UIScene; Hermes UTF-16 TextDecoder for h3-js; ATS local-networking key.

## Known issues / decisions
- `supabase/config.toml` (local CLI) still enables anonymous sign-ins; hosted has them off and the API refuses them anyway.
- The per-IP rate limits trust Vercel's `x-forwarded-for` / `x-real-ip` (Vercel overwrites them); per-email/per-user limits don't depend on it.
- VisionCamera v5 (SDK 57): EXIF not exposed to JS. expo-notifications removed (push entitlement unsignable with a free Apple ID).
- Something in the local Claude tooling (a ruflo hook) has written stray files named `$L`/`$WT` and once truncated three source files in the working copy; committed history was intact. Deploys use clean worktrees.

## Human TODOs
- [ ] Add the two Resend CNAMEs above at the `panopticpigskin.tech` registrar; tell Claude which inbox to send a test reset to.
- [ ] Mac: `git pull`, `.env` API URL = Vercel, Release build to the iPhone (see "Phone build"). The previously installed build no longer works (anonymous sign-in removed).
- [ ] Take real test photos with the app (positives: tub + ruler, puddles; negatives: random objects, a screen) → fixtures → eval.
- [ ] Revoke the Supabase access token and Vercel token after the hackathon; move the admin password into a password manager and delete `C:\Users\sumedh\.groundtruth-admin.txt`.
- [ ] Delete leftover folders `$WT` (repo root, apps/web) and `C:\Users\sumedh\AppData\Local\Temp\{gtm,gtx,gta,gtd,gtr}` when OneDrive/path limits allow.

## Phone build (Mac)
```
cd ~/DataGo && git restore pnpm-lock.yaml apps/mobile/tsconfig.json 2>/dev/null; git pull && pnpm install
cd apps/mobile   # .env: EXPO_PUBLIC_API_BASE_URL=https://groundtruth-two-snowy.vercel.app (+ Supabase URL, anon key)
IOS_BUNDLE_ID=com.<name>.groundtruth npx expo prebuild --platform ios --clean
IOS_BUNDLE_ID=com.<name>.groundtruth npx expo run:ios --device "<iPhone name>" --configuration Release
```

## Device test steps
1. **Accounts:** Create account → onboarding (permissions) → map. Sign out/in. Forgot password (once DNS is verified).
2. **Voice (dev builds only; hidden in Release):** voice test screen → "hello" → reply ≲1.5 s; talk over it → stops.
3. **Capture gate:** For you → bounty → Start capture → safety question → checklist rows go green; shutter unlocks only after the server confirms 2 all-green checks ("Scene verified 2/2").
4. **Screen flagging:** a laptop showing a flood photo → "Real scene" red, shutter stays locked.
5. **Can't verify:** turn off Wi-Fi/cellular during framing → "CAN'T VERIFY SCENE", shutter stays locked, recovers when back online.
6. **Off-topic:** capture something unrelated (if it gets through) → rejected `OFF_TOPIC` with "Point the camera at: …".
7. **Full loop:** challenge → 3-photo burst → field notes → verification checklist (~45 s) → accepted → wallet; dashboard shows it live; `/data` shows it once accepted with confidence ≥ 0.75.
8. **Cashew test:** "Cashew package label test" bounty (3 km around Georgia Tech) — box + label + weight + a pen/phone for scale.
9. **Account data:** Account → Download my data (share sheet); Delete account (type DELETE).
