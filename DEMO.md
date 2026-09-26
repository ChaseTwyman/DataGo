# GroundTruth — Demo runbook

Three minutes, one phone, one laptop. Everything runs in production: the dashboard and API on Vercel
(https://groundtruth-two-snowy.vercel.app), data on hosted Supabase, real Grok. No laptop server is
needed. Setup details are in [`README.md`](README.md); the original script is PRD §19.

**Rule for the whole demo: real captures only.** Nothing staged with mock mode or seed scripts goes into
the public dataset, and we never claim more than we measured.

---

## Pre-demo checklist

### The day before

- [ ] **Rebuild the iPhone app.** Free Apple ID signing expires after 7 days. On the Mac:
      `git pull && pnpm install`, then in `apps/mobile`:
      `IOS_BUNDLE_ID=com.<name>.groundtruth npx expo prebuild --platform ios --clean` and
      `npx expo run:ios --device "<iPhone name>" --configuration Release`.
      Confirm `apps/mobile/.env` points `EXPO_PUBLIC_API_BASE_URL` at the Vercel URL (Release embeds
      the JS, so no Metro or LAN is needed afterwards). Open the app off Wi-Fi once to prove it.
- [ ] **Health check:** `GET https://groundtruth-two-snowy.vercel.app/api/health` returns
      `ok: true`, `backend: "supabase"`, `mock_grok: false`, `demo_mode: true`.
- [ ] **Admin login works** in the dashboard (`researcher@groundtruth.dev`, password from private
      storage; if lost, rotate with `apps/web/scripts/rotate-admin-password.ts`). Also sign in on the
      phone with a contributor account (can be the same account).
- [ ] **Pre-generate Imagine assets** so no one waits on a 15 s generation live: dashboard →
      **Protocols** → example image for Street flood depth (or `pnpm --filter @groundtruth/web
      generate:examples`). Briefing clips can be generated with `POST /api/bounties/:id/briefing-video`,
      but no screen plays them yet, so don't put them in the script.
- [ ] **Rehearse the staged capture end to end with real Grok** (tub + ruler, below): gate unlocks,
      verification accepts. Also rehearse the screen attack. If the relevance stage calls the tub
      `OFF_TOPIC`, fix the staging (more water, curb-like edge, ruler clearly in the water) rather than
      the verifier.
- [ ] **Run one red-team attack** (AI-generated photo) from the **Red team** page and confirm it is
      caught (`CHALLENGE_FAILED` + `C2PA_AI_GENERATED`, ~1 min).
- [ ] **Public dataset is clean:** `/data` shows only real, verified rows. Do not run
      `seed:open-data` or `MOCK_GROK` against production. Spawn-event neighbours are marked
      `verifier = none` and never publish, which is fine.
- [ ] **Record the backup video** of a full real capture (outdoor puddle if possible) and a screen
      recording of the dashboard receiving it.
- [ ] Check Vercel and Supabase status pages and the xAI console (credit balance).

### Morning of

- [ ] Phone charged to 100%, battery cable, Low Power Mode off, Do Not Disturb on, auto-lock off,
      brightness up, volume up (the voice guide talks).
- [ ] **Phone hotspot** ready as the network backup, tested with the laptop.
- [ ] Laptop: dashboard signed in; tabs open on **Bounties**, the bounty detail map, **Datasets**,
      **Red team**, and `/data`. Backup video on the desktop.
- [ ] Location permission granted; open the app once at the venue so GPS has a fix (≤ 25 m accuracy).
- [ ] Staging set up (below), well lit.

---

## Indoor staging

- **Hero scene:** a clear tub of water on the floor with a ruler (or measuring stick) standing in it:
  the protocol's reference object. Light it evenly; avoid glare on the water surface.
- **Demo mode** waives the precipitation plausibility check and says so on screen ("waived (demo)").
  Say it out loud if a judge looks at the checklist; it is never hidden.
- **Screen attack:** have a flood photo open full-screen on the laptop (or a Grok Imagine fake from
  the red-team run).
- **Generality fallback, Protocol Studio:** before the demo, draft a second protocol in **Protocol
  Studio** from one plain-language sentence (our test case is a cashew box: e.g. "Photograph a sealed
  cashew box with its label and expiry date visible"), review it, publish it, and post a bounty on it.
  If time allows (or if the flood beat fails), show the phone briefing and gate running the new
  protocol: same app, new checklist, no code change.

---

## The script (3:00)

Two people: **Presenter** (laptop, talks) and **Field** (phone, captures). Mirror the phone to the
projector if you can.

| Time | Beat | Who does what |
|---|---|---|
| 0:00-0:20 | **Hook** | "When a flash flood hits, cities have almost no idea which streets flooded or how deep. By the time anyone looks, the water, and the data, are gone." |
| 0:20-0:45 | **Researcher posts a bounty** | Dashboard → **Bounties**. Either create one (**New bounty**) or use the demo card: click the map at the venue → spawn event (active flood bounty, event started 20 min ago, a few neighbouring observations). Show the coverage map: empty hexes surge toward ×5. |
| 0:45-1:00 | **Phone lists it, briefing** | Field refreshes **For you** (or the map): the bounty card shows the surge badge and price. Open it: why it matters, safety rules, the **Example (AI-generated)** ideal shot, price locked when capture starts. |
| 1:00-1:50 | **Live capture** | Start capture. The voice guide asks the safety question → "yes". First frame the tub without the ruler: the checklist shows the ruler missing, the shutter stays locked, the guide says what's missing. Add the ruler: rows go green (haptic ticks), the server unlocks the shutter after 2 real all-green checks. Say "capture": challenge (e.g. "step left"), countdown, 3-photo burst. Answer the field questions by voice or tap. Submit. |
| 1:50-2:15 | **Verification → accepted → wallet** | The checklist animates stage by stage. Verification takes ~40 s: **start the red-team attack on the laptop now** so it finishes in time, and talk through the stages while it runs (gate, relevance, challenge, protocol, authenticity + C2PA, context, duplicates, corroboration). Accepted, amount counts up, **Wallet** credited. On the dashboard the observation appears on the bounty map and in **Datasets** with depth estimate and confidence; `/data` shows the privacy-coarsened public row. |
| 2:15-2:40 | **Red team** | **Red team** page: the AI-generated fake is rejected with reasons: `C2PA_AI_GENERATED` (Grok Imagine signs its output) and `CHALLENGE_FAILED` (one image can't show parallax). Then Field points the phone at the fake on the laptop screen: the "Real scene" row goes red, the shutter stays locked. Be honest: the model alone is weak at spotting AI images; the provenance check, the live gate and the burst are what catch them. |
| 2:40-3:00 | **Vision** | "Any protocol, any place: flood depth today, crop disease, hail, smoke, algal blooms tomorrow." (Optional: flash the Protocol Studio draft.) "Every phone becomes a verified scientific instrument." |

Timings measured on Vercel: frame check ~1.3 s, relevance ~2 s, grok-4.7 verification ~41 s,
red-team run ~1 min.

---

## Recovery

| Symptom | Do this |
|---|---|
| **Venue Wi-Fi down or slow** | Switch phone and laptop to the phone hotspot. The Release app needs only internet. |
| **Grok slow or unavailable during framing** | The gate shows **CAN'T VERIFY SCENE** (amber, retrying) and the shutter stays locked. That is the design: no degraded unlock. Say so, wait a few seconds, or back out and start a new capture. After the per-session check cap it shows **CHECK LIMIT REACHED**: start a new session. |
| **Verification pending for a long time or a stage errors** | A Grok error or timeout never auto-accepts: the submission lands in **needs review**. Open **Review** (the review queue) on the dashboard and approve it (pays the locked quote). This is a feature worth showing: humans handle borderline cases. |
| **Rejected as `OFF_TOPIC` or a missing element** | Protocol misses are retryable: start a new capture and fix the framing (ruler clearly in the water). |
| **Phone app won't open ("untrusted developer" or crashes on launch)** | The 7-day free signing expired: rebuild from the Mac (checklist step 1), then trust the profile in Settings → General → VPN & Device Management. No Mac at the venue: use the backup video. |
| **Bounty doesn't appear on the phone** | Location: check permission and GPS accuracy; spawn the event at the phone's actual position. Pull to refresh. Sign-in: make sure the phone account isn't suspended. |
| **Dashboard or API errors** | Check `/api/health`, then the Vercel status page, Supabase status and the xAI console. If production is down, switch to the backup video for the capture beats and narrate. |
| **Red-team run slow** | It takes ~1 min; start it early (during verification). Past results stay listed on the Red team page, so show the most recent caught run. |
| **Everything is on fire** | Backup video of the real capture + dashboard recording, and narrate the script over it. |

---

## After the demo

- Remove any test bounties you don't want listed. Don't run `pnpm demo:reset` against production
  unless you mean to wipe it.
- Note latency, failures and judge questions in `STATUS.md`.
