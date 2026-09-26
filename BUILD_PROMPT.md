# Build GroundTruth

You are the lead engineer on a two-person hackathon team building **GroundTruth**: a mobile app and researcher dashboard where researchers post paid "bounties" for real-world data, Grok (xAI) coaches contributors by voice to capture that data to a research protocol, and a layered verification pipeline decides what is real before anyone is paid.

`PRD.md` in the repo root is the source of truth for **what** to build. Read all of it before writing any code. This document tells you **how** to build it. If they conflict, this document wins on technical choices and the PRD wins on product behavior.

---

## 0. How to work

- **Plan first.** Write `PLAN.md`: the milestones below broken into concrete tasks with the files you will create. Then work through the milestones in order without waiting for approval.
- **Don't block on humans.** Stop to ask only for things only a human can do (credentials, device signing). Keep building everything else in mock mode and list what you need in `STATUS.md`.
- **Keep `STATUS.md` current** after every milestone: done, in progress, real vs mocked, known issues, and exact manual test steps for the phone.
- **Create `CLAUDE.md`** with conventions, commands, and architecture notes for future sessions.
- **Commit after each milestone** (`feat(m3): verification pipeline`) with typecheck, lint, and tests passing.
- **Never guess xAI API details.** Section 5 was verified against docs.x.ai on September 26, 2026. For anything else, read the docs: every page at docs.x.ai has a Markdown version at the same URL with `.md` appended, and the index is at `https://docs.x.ai/llms.txt`.
- **Verify what you can headlessly.** You can't run the iPhone app yourself, so typecheck the mobile app, run `npx expo prebuild` successfully, unit-test all pure logic, and exercise every API route with scripts in mock mode. Put device test steps in `STATUS.md`.
- Pure logic (pricing, decisions, H3, schema composition, reason codes) lives in `packages/shared` with unit tests. Keep modules small and typed; no `any`.
- Where web and mobile work is independent, you may use parallel subagents.
- Secrets never go in git. Commit `.env.example` files only.

---

## 1. Definition of done

On a physical iPhone (development build) plus the dashboard in a desktop browser, with real Grok calls:

1. A researcher creates a flood-depth bounty on the dashboard (or spawns the demo event). Coverage hexagons and surge prices appear.
2. The phone lists the bounty with its live price. Opening it shows the briefing and a Grok Imagine example image. Starting capture locks the price.
3. Grok Voice runs the safety check-in and coaches. The checklist overlay updates from live frame checks. The shutter stays locked until every required element is green on two consecutive checks. A laptop screen held up to the camera gets flagged.
4. Saying "capture" (or tapping) issues a random challenge, takes a 3-frame burst, collects a spoken field note, and uploads.
5. The phone's verification checklist animates from realtime updates, ends in "accepted," and the wallet is credited.
6. The dashboard shows the observation live on the map and in the dataset; CSV and GeoJSON export work.
7. The red-team console generates a Grok Imagine fake, runs it through the pipeline, and shows it caught with reasons.
8. With `MOCK_GROK=1`, the whole loop runs with no xAI key.

---

## 2. Tech stack (locked)

- **Monorepo:** pnpm workspaces, TypeScript `strict` everywhere, current Node LTS, ESLint + Prettier, Vitest.
- **`apps/mobile`:** Expo (latest SDK) with `expo-router` and a **development build** (`expo-dev-client`). Do not target Expo Go.
  - `react-native-vision-camera` (preview, `takeSnapshot` for frame checks, `takePhoto` for the burst; set `audio={false}` so it never touches the audio session)
  - `react-native-audio-api` (mic streaming via `AudioRecorder.onAudioReady`; playback via `AudioBufferQueueSourceNode`)
  - `expo-location`, `expo-sensors` (DeviceMotion), `expo-haptics`, `expo-image-manipulator`, `expo-file-system`, `expo-notifications` (local, P1)
  - `react-native-maps` (Apple Maps on iOS), `@supabase/supabase-js`, `@tanstack/react-query`, `zustand`
  - iOS is the demo target; keep Android compiling.
- **`apps/web`:** Next.js (App Router) + Tailwind + shadcn/ui. The API is route handlers under `app/api`. Long work after responding uses `after()` from `next/server`.
  - `openai` npm SDK with `baseURL: "https://api.x.ai/v1"` for all Grok REST calls
  - `react-map-gl/maplibre` + `maplibre-gl` with the OpenFreeMap style `https://tiles.openfreemap.org/styles/positron` (no key)
  - `h3-js`, `sharp` (resize + dHash), `suncalc`, `zod`
- **`packages/shared`:** zod schemas and TS types for every API payload; the protocol type and the flood protocol JSON from PRD §8; pricing, decision, and H3 helpers; reason codes; JSON-schema composition for verification output.
- **`supabase/`:** SQL migrations, seed, storage buckets, RLS policies, realtime publication. Must work with `supabase start` locally and with a hosted project.
- **Auth:** Supabase Auth. Contributors use anonymous sign-in plus a profile row; a seeded researcher/admin uses email + password. Mobile sends the Supabase access token as `Authorization: Bearer`; routes verify it with `supabase.auth.getUser(token)` and check `profiles.role`.

---

## 3. Repo layout

```
groundtruth/
├── PRD.md  BUILD_PROMPT.md  PLAN.md  STATUS.md  CLAUDE.md  README.md  DEMO.md
├── package.json  pnpm-workspace.yaml  tsconfig.base.json
├── packages/shared/src/
│   ├── contracts/        # zod schemas per endpoint (request + response)
│   ├── protocols/        # Protocol type, street-flood-depth.json, (P1) leaf-disease-scout.json
│   ├── pricing.ts        # computePrice(), surge, locked quote
│   ├── decision.ts       # decide(checks) -> {status, confidence, reasonCodes, payoutMultiplier}
│   ├── trust.ts          # trust score updates
│   ├── h3.ts             # cells for circle/polygon, boundaries as GeoJSON
│   ├── verificationSchema.ts  # builds JSON schema = base + protocol.extraction_schema
│   └── reasonCodes.ts
├── apps/web/
│   ├── app/(dashboard)/  # bounties, live, review, datasets, red-team
│   ├── app/api/...       # routes from PRD §16
│   ├── lib/grok/         # client.ts, json.ts, vision.ts, imagine.ts, voiceToken.ts, mocks/
│   ├── lib/verification/ # pipeline.ts + one file per stage
│   ├── lib/context/      # openMeteo.ts, nws.ts, daylight.ts
│   ├── lib/supabase/     # server + admin clients
│   ├── scripts/          # eval-verification.ts, generate-examples.ts
│   └── test/fixtures/
├── apps/mobile/
│   ├── app/              # expo-router screens: (tabs)/map, (tabs)/foryou, (tabs)/wallet, bounty/[id], capture/[sessionId], result/[submissionId], voice-test, onboarding
│   ├── src/voice/        # useGrokVoice.ts, audio.ts (pcm helpers), tools.ts, instructions.ts
│   ├── src/capture/      # useCaptureGate.ts, useDeviceChecks.ts, burst.ts, ChecklistOverlay.tsx
│   └── src/api/          # typed client built on shared contracts
└── supabase/migrations/  seed.sql  config.toml
```

---

## 4. Environment

`apps/web/.env.example`
```
XAI_API_KEY=
XAI_BASE_URL=https://api.x.ai/v1
GROK_REASONING_MODEL=grok-4.7
GROK_FAST_VISION_MODEL=grok-4.20-non-reasoning
GROK_IMAGE_MODEL=grok-imagine-image-2.0
GROK_VIDEO_MODEL=grok-imagine-video-1.5
GROK_VOICE_MODEL=grok-voice-latest
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NWS_USER_AGENT="GroundTruth hackathon (you@example.com)"
MOCK_GROK=0
DEMO_MODE=1
```

`apps/mobile/.env.example`
```
EXPO_PUBLIC_API_BASE_URL=http://<laptop-LAN-IP>:3000
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_GROK_VOICE_MODEL=grok-voice-latest
EXPO_PUBLIC_VOICE_REASONING_EFFORT=none
```

---

## 5. xAI API facts (verified September 26, 2026)

**REST (server only)**
- Base URL `https://api.x.ai/v1`, OpenAI-SDK compatible. Use the **Responses API** (`client.responses.create`). Chat Completions is legacy.
- `grok-4.7`: flagship reasoning model with image input. `grok-4.20-non-reasoning`: fast, text + image input, function calling, structured outputs.
- Image input content part: `{ type: "input_image", image_url: "data:image/jpeg;base64,<...>", detail: "high" }` (jpg/png, ≤ 20 MiB). Set `store: false` on image requests (the docs advise against storing history when sending images).
- Structured outputs on Responses:
  ```ts
  text: { format: { type: "json_schema", name: "frame_check", schema, strict: true } }
  ```
  `additionalProperties` defaults to false; make fields nullable with `type: ["string", "null"]`. Read the result from `response.output_text` (or find the `message` item's `output_text` part), then validate with zod. Convert zod → JSON Schema with zod v4's `z.toJSONSchema()`.
- Server-side tools on Responses: `{ type: "web_search" }`, `{ type: "x_search" }` (Opportunity Radar, P1).
- **Image generation:** `POST /v1/images/generations` (or `client.images.generate`) with `model`, `prompt`, `aspect_ratio` (e.g. `"16:9"`, `"3:4"`), `response_format: "b64_json"`. Hosted URLs are temporary, so always store the bytes in Supabase Storage.
- **Video generation:** `POST /v1/videos/generations` with `{ model, prompt, duration (1–15), aspect_ratio: "9:16", resolution: "720p" }` → `{ request_id }`. Poll `GET /v1/videos/{request_id}` until `status` is `done` (URL at `video.url`), `failed`, or `expired`. Can take minutes; run as a background job and store the file.
- **Ephemeral voice token:** `POST /v1/realtime/client_secrets` with the API key and body `{ "expires_after": { "seconds": 300 } }`. Log the response shape the first time and return only the token value and expiry to the phone.

**Realtime voice (phone → xAI directly)**
- URL: `wss://api.x.ai/v1/realtime?model=grok-voice-latest`. React Native's `WebSocket` accepts a third options argument for headers:
  ```ts
  new WebSocket(url, undefined, { headers: { Authorization: "Bearer " + ephemeralToken } })
  ```
  (Browsers instead use the subprotocol `xai-client-secret.<token>`.)
- OpenAI Realtime–compatible events. Client: `session.update`, `input_audio_buffer.append` (base64 PCM16), `conversation.item.create`, `response.create`. Server: `session.created`, `session.updated`, audio deltas (base64 PCM16), transcript deltas, `input_audio_buffer.speech_started`, `response.function_call_arguments.done`, `response.done`, `error`. xAI uses OpenAI's **beta** names for some output events, so handle both spellings: audio as `response.output_audio.delta` or `response.audio.delta`, transcripts as `response.output_audio_transcript.delta` or `response.audio_transcript.delta`. Log unknown event types during the spike and adapt.
- Session config:
  ```json
  {
    "type": "session.update",
    "session": {
      "voice": "eve",
      "instructions": "<built from protocol, see §7.3>",
      "turn_detection": { "type": "server_vad" },
      "reasoning": { "effort": "none" },
      "audio": {
        "input":  { "format": { "type": "audio/pcm", "rate": 24000 } },
        "output": { "format": { "type": "audio/pcm", "rate": 24000 } }
      },
      "tools": [ /* function tools, §7.3 */ ]
    }
  }
  ```
- Function calls: on `response.function_call_arguments.done` read `name`, `call_id`, `arguments`; run the tool; send `conversation.item.create` with `{ type: "function_call_output", call_id, output }`; **wait for current audio playback to finish**, then send `response.create`. If several calls arrive, answer all of them before one `response.create`.
- xAI extension `force_message` speaks a scripted line verbatim (use it for the safety opener; do not send `response.create` after it):
  ```json
  { "type": "conversation.item.create",
    "item": { "type": "force_message", "role": "assistant", "interruptible": false,
              "content": [{ "type": "output_text", "text": "..." }] } }
  ```
- Per-response override: `{ "type": "response.create", "response": { "instructions": "..." } }`.
- Fallback if realtime audio is unusable on device: push-to-talk using `/v1/stt` (transcribe) → `grok-4.20-non-reasoning` → `/v1/tts` (speak). Read those pages before implementing.

**Grok wrapper (`apps/web/lib/grok/`)**
- `grokJSON<T>({ model, system, content, schema, name, timeoutMs })`: Responses call with `store: false` and strict JSON schema; zod-validate; one retry on parse failure; log model, duration, and usage.
- `grokImage({ prompt, aspectRatio }) → Buffer`, `grokVideoStart()` / `grokVideoPoll()`, `mintVoiceToken()`.
- When `MOCK_GROK=1`, every function returns deterministic fixtures from `lib/grok/mocks/` (including a "screen recapture" frame-check variant triggered by a test header) so the UI and tests run offline.

---

## 6. Milestones

### M0 — Foundations and contracts
- Scaffold the monorepo, lint, tsconfig, Vitest.
- `packages/shared`: zod contracts for every endpoint in PRD §16; the flood protocol JSON from PRD §8; `computePrice` (unit tests must reproduce the worked example in PRD §10: $10.00 ×5.0 and $4.24 ×2.1); `decide()` implementing PRD §9.3 with tests for every hard-fail and band; trust updates; H3 helpers (res 9).
- Supabase migration for every table in PRD §15, buckets `observations` (private) and `synthetic`, the `observations_export` view, RLS (contributors: read active bounties, own sessions/submissions/ledger; researchers: read everything for bounties they own; service role for the pipeline), realtime on `submissions` and `bounties`.
- Seed: researcher/admin account, flood protocol (published), one active demo bounty.
- Grok wrapper with mock mode.
- **Accept:** `pnpm -r typecheck && pnpm -r test` pass; `supabase db reset` seeds cleanly.

### M0.5 — Voice spike (do this right after M0; it is the highest technical risk)
- `POST /api/voice/token`.
- Mobile `voice-test` screen: fetch token, connect, `session.update`, stream mic, play replies, show live captions, support barge-in.
- Audio details: 24 kHz mono PCM16 both directions. Mic: `AudioRecorder.onAudioReady` with ~100 ms buffers → Float32 → Int16 little-endian → base64 → `input_audio_buffer.append`. Playback: base64 → Int16 → Float32 → `AudioBuffer` → enqueue on one `AudioBufferQueueSourceNode`. On `input_audio_buffer.speech_started`, stop playback and clear the queue. iOS audio session: play-and-record, voice-chat mode (echo cancellation), default to speaker, allow Bluetooth (check `react-native-audio-api` docs for exact option names). Start mic capture and the socket connection in parallel; buffer mic audio until the socket opens.
- **Accept (human, on device):** say hello → hear Grok reply within ~1.5 s; talk over it → it stops. Record latency and issues in `STATUS.md`. If audio fails after honest effort, implement the push-to-talk fallback and move on.

### M1 — Skeleton loop (mocked AI)
- **Dashboard:** researcher login; bounty list; create-bounty form (map click to set center, radius slider → H3 cells; window, prices, target per cell, budget); bounty page with MapLibre hex layer (GeoJSON from `cellToBoundary`) and a live submission stream via Supabase realtime.
- **Mobile:** anonymous auth; Map and "For you" tabs from `GET /api/bounties/nearby`; bounty detail; capture screen with camera and single-photo capture; upload via signed URL; result screen subscribed to its submission row.
- **API:** nearby, sessions (nonce, random challenge from the protocol pool, locked quote, 15-min expiry, signed upload URLs), submissions, pipeline skeleton whose stages write `{status, score, reasonCodes, evidence, ms}` into `submissions.checks` one by one.
- **Accept:** the full loop works with `MOCK_GROK=1`, verified by a script that calls the APIs end to end.

### M2 — Capture gate and challenge
- `POST /api/capture/frame-check` using `GROK_FAST_VISION_MODEL` and the schema in §7.1. Max 1 in flight and 90 per session.
- `useDeviceChecks`: DeviceMotion tilt ≤ protocol `max_tilt_deg`, steadiness (low rotation rate for 500 ms), location accuracy ≤ 25 m and inside the bounty area.
- `useCaptureGate`: state machine (`locating → framing → ready → challenge → capturing → notes → uploading`). Frame loop: every ~1.2 s, only when device checks pass and nothing is in flight, `takeSnapshot` → resize to 640 px JPEG q≈0.6 → frame-check. Shutter unlocks after 2 consecutive all-green results and no screen/print suspicion. If Grok errors or is slow for 10 s, fall back to device checks only and record `gate_degraded: true`.
- `ChecklistOverlay`: one row per required element with haptic tick on green; locked shutter shows a lock and the single most important missing item.
- Challenge: show and speak the instruction, capture `frames` photos at `frame_interval_ms` with `takePhoto`, collect EXIF, sensor snapshot, location + accuracy, device model, OS.
- There is **no photo-library import anywhere** in the app.
- **Accept:** mock tests for the state machine; device steps in `STATUS.md`.

### M3 — Verification pipeline (real)
- One file per stage in PRD §9.2, run in order inside `after()`, each updating `checks` so the phone animates live:
  1. Session integrity (open, not expired, nonce matches, captured within window, metadata present).
  2–4. One `grok-4.7` call with all burst frames → schema in §7.2 (challenge, real 3D scene, elements, quality, authenticity, scene, extraction, scores). Split its output into the challenge, protocol, and authenticity stages.
  5. Context: inside area (H3 + geometry), Open-Meteo past precipitation (`hourly=precipitation&past_days=2`, sum over `lookback_hours`), NWS active alerts at the point (`User-Agent` required), daylight via `suncalc` compared with the model's `scene.lighting`. In `DEMO_MODE`, the precipitation check returns `waived` with reason `DEMO_WAIVER` and the UI must show it.
  6. dHash (via `sharp`) against all prior submission hashes (Hamming ≤ 6 → `DUPLICATE`); ≤ 6 submissions per user per cell per hour; impossible travel > 150 km/h between a user's consecutive submissions.
  7. Corroboration (accepted observations of the same bounty within 300 m / 60 min whose `depth_cm` is within ±10 cm → boost) and trust score.
- Final: `decide()` → status, reason codes, confidence, payout (`locked quote × multiplier`, 0.8–1.2 from protocol score) → ledger entry → trust update → bounty `spent_cents`.
- Any stage error → that stage `error` → submission `needs_review`. Never auto-accept on error.
- `pnpm eval:verification`: runs the real pipeline over `apps/web/test/fixtures` (real photos the team adds, plus negatives generated by `scripts/generate-examples.ts` with Grok Imagine) and prints a confusion table.
- **Accept:** unit + mock integration tests pass; the eval script runs.

### M4 — Voice field guide
- `useGrokVoice({ protocol, bounty, onToolCall })` built on the spike.
- On connect: `session.update` with instructions from §7.3 and the tools below, then a `force_message` with the protocol's safety opener and check-in question.
- Tools: `get_capture_status()`, `trigger_capture()`, `save_field_note({ question_id, value })`, `report_unsafe({ description })` (ends the session, no penalty), `end_session({ reason })`.
- Camera status injection: when the gate's checklist changes (debounced 1 s, never while the agent is speaking), send `conversation.item.create` with a user `input_text` of the form `[camera_status] {"missing":["waterline"],"hint":"Tilt down to the waterline","ready":false}`, then `response.create` with per-response instructions "Give one short coaching sentence based on the latest camera_status." When ready, the agent says "Hold still" and waits for "capture."
- Show captions for both sides (noisy environments, accessibility).
- **Accept:** hands-free capture works on device (human-verified); tool handlers unit-tested.

### M5 — Economy and data
- Live prices in `nearby` and `GET /api/bounties/:id/coverage`; quotes locked in sessions; budget enforcement; cells paused when they intersect NWS alerts with severity `Extreme` or events in a configurable list (e.g. Flash Flood Emergency, Tornado Warning), shown as paused with the reason.
- Mobile wallet tab (balance + ledger).
- Dashboard: coverage heatmap by fill ratio with price labels; review queue (approve/reject `needs_review`, which writes the ledger and trust updates); datasets tab with CSV/GeoJSON export plus a data dictionary generated from the protocol's extraction schema.

### M6 — Grok Imagine and red team
- Example image per protocol (admin button + `scripts/generate-examples.ts`), stored in `synthetic`, always rendered with an "EXAMPLE — AI-generated" label.
- Red-team console with three attacks: `ai_generated` (Imagine prompt built from the bounty and protocol to look like a genuine capture), `recycled` (a previously accepted image), `wrong_place_time` (valid image, coordinates/time outside the bounty). Run through `runPipeline({ source: "redteam" })`, which skips only session integrity. Save to `redteam_runs` + `synthetic_media`; show per-attack results and caught rate.
- Synthetic guard: the real pipeline rejects any media path in the `synthetic` bucket, and a test proves it.

### M7 — P1 features (in this order; stop when time runs out)
1. Voice onboarding with a `save_profile` tool → profile review screen → match scoring via `GROK_FAST_VISION_MODEL` (cached in `match_cache`, including notification copy) → local notifications.
2. Opportunity Radar: `POST /api/radar/scan` pulls NWS alerts for a region, calls `grok-4.7` with `x_search` + `web_search` and a strict schema to draft bounties; the researcher approves them.
3. Protocol Studio: plain-language need → `grok-4.7` drafts a protocol matching the shared Protocol zod schema → editor → publish; seed `leaf-disease-scout` this way.
4. Briefing video: background job with Imagine video (6–8 s, 9:16, 720p) → stored → shown on bounty detail.

### M8 — Demo readiness
- `POST /api/demo/spawn-event { lat, lng }` (DEMO_MODE only): creates an active flood bounty centered there with `event_started_at = now − 20 min`, seeds 2–3 accepted observations in neighboring cells, generates the example image if missing.
- `pnpm demo:reset` resets the database to the demo state.
- `README.md`: setup from zero (prerequisites, Supabase local or hosted, env files, `pnpm dev:web`, `cd apps/mobile && npx expo run:ios --device`, LAN IP or tunnel note).
- `DEMO.md`: pre-demo checklist, the script from PRD §19, the indoor staging (tub of water + ruler), and recovery steps.

---

## 7. Prompts and schemas

### 7.1 Frame check (fast vision)
Schema:
```ts
FrameCheck = {
  elements: { id: <enum of protocol element ids>, visible: boolean, confidence: number }[],
  framing_ok: boolean,
  blur_ok: boolean,
  lighting_ok: boolean,
  suspected_screen_or_print: { value: boolean, confidence: number },
  hint: string // ≤ 80 chars, one imperative instruction
}
```
System prompt (fill from the protocol):
> You are the real-time camera assistant for a scientific data-collection protocol called "{name}". You see one low-resolution frame from a phone camera. Required elements: {id: description, …}. Judge only what is visible; do not assume. Set `suspected_screen_or_print` if you see moiré, a pixel grid, a screen bezel or display glare, or paper edges and print texture. Give one short imperative hint that would most improve the shot. If every element is visible and the shot is steady and well lit, the hint is "Hold still."

### 7.2 Verification (reasoning vision)
Build the JSON schema at runtime: base schema + `extraction` = the protocol's `extraction_schema`.
```ts
Verification = {
  challenge: { performed: boolean, confidence: number, evidence: string },
  real_3d_scene: { value: boolean, confidence: number, evidence: string },
  elements: { id: string, present: boolean, confidence: number, evidence: string }[],
  quality: { blur_ok: boolean, lighting_ok: boolean, framing_ok: boolean },
  authenticity: {
    screen_recapture:     { suspected: boolean, confidence: number, evidence: string },
    printed_photo:        { suspected: boolean, confidence: number, evidence: string },
    ai_generated:         { suspected: boolean, confidence: number, evidence: string },
    edited_or_composited: { suspected: boolean, confidence: number, evidence: string }
  },
  scene: { lighting: "day" | "dusk_dawn" | "night" | "unclear", visible_weather: string, internal_inconsistencies: string[] },
  extraction: <protocol.extraction_schema>,
  protocol_score: number,     // 0..1
  authenticity_score: number, // 0..1
  summary: string
}
```
System prompt:
> You are a skeptical auditor for a paid scientific data network. Contributors are paid per accepted observation, so some will try to cheat. You receive {n} frames captured {interval} ms apart while the contributor was instructed: "{challenge.instruction}". Expected if genuine: "{challenge.expect}". Protocol: {full protocol JSON}. For every judgment, cite specific visual evidence. Check whether the frames show a real three-dimensional scene with natural parallax between frames, or a flat surface such as a screen or print. Look for signs of AI generation, editing, or compositing, and for internal inconsistencies (for example dry pavement beside supposed floodwater, mismatched shadows or reflections). Score conservatively: when unsure, lower the score rather than guess. For extraction, estimate values from the reference object and state the height you assumed (typical: curb ≈ 15 cm, car tire ≈ 65 cm tall, fire hydrant ≈ 75 cm; for a measuring stick, read the markings).

### 7.3 Voice agent instructions (second person, fixed section order)
```
# Role
You are the GroundTruth field guide. You help a volunteer capture one scientific observation safely and correctly, hands-free.

# Safety (always first)
{protocol.safety.rules as bullets}
If the user says they feel unsafe, is unsure, or describes danger, call report_unsafe and thank them. Never tell them to approach water, hazards, or traffic.

# Protocol: {name}
Why it matters: {why_it_matters}
Required in frame: {required elements}
Field questions to ask after capture: {field_questions}

# How you coach
- You cannot see the camera. You receive [camera_status] messages; coach only from the latest one.
- One short sentence at a time, under 12 words.
- When ready is true, say "Hold still" and wait. When the user says "capture" or similar, call trigger_capture.
- After capture, ask each field question once and call save_field_note with the answer.
- Then say the observation is being verified and call end_session.

# Style
Calm, warm, brief. Reply in the user's language.
```

---

## 8. UX direction

- **Mobile:** dark, map-first. Bounty cards lead with a large price and a surge badge (amber at ×2 or more). The capture screen is full-bleed camera with a bottom-sheet checklist; items turn green with a haptic tick; the locked shutter shows a lock and the single most important missing item. The verification screen is an animated per-layer checklist; the accepted moment counts the amount up into the wallet. Captions for the voice agent are always visible.
- **Dashboard:** left rail (Bounties, Live, Review, Datasets, Red team). Bounty page is map-centric with a live submission stream on the right; each submission expands to show frames, the check table with scores and evidence, and extracted fields.
- **Accessibility:** 44 pt touch targets, statuses shown with icon + color + text, captions for all speech.

---

## 9. Guardrails

- `XAI_API_KEY` exists only on the server. The phone gets ephemeral tokens only.
- No photo-library import anywhere.
- Synthetic media never reaches `submissions` or exports (enforced in code and tested).
- Every route validates input with the shared zod contracts and checks auth; admin routes require the admin/researcher role.
- All model names come from env.
- On any Grok failure: the gate degrades gracefully (§M2) and the pipeline routes to `needs_review`, never auto-accept.
- Log every Grok call with model, duration, and token usage to track cost.

---

## 10. Human TODOs (list these in STATUS.md; don't block on them)

- Create a Supabase project (or run `supabase start`) and fill in both env files.
- Add the xAI API key.
- Sign the iOS build with an Apple ID in Xcode; enable Developer Mode on the iPhone.
- Put the laptop and phone on the same network (or use a tunnel) and set `EXPO_PUBLIC_API_BASE_URL`.
- Take ~20 real test photos (good and bad) for `test/fixtures`.
