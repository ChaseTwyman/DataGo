# Verification fixtures

`pnpm eval:verification` runs the **real** pipeline (`runPipeline`, source `eval`: relevance on the fast
vision model, grok-4.7 verification, context) over every case here. It prints:
- a confusion table (expected status × decision) and the PRD §5 targets: positives accepted ≥ 80%,
  negatives rejected or sent to review 100%
- per-stage timings (median / max)
- Grok calls per model with token usage from the call log, and a cost estimate when you pass
  `EVAL_PRICES='{"grok-4.7":{"in":<usd/Mtok>,"out":<usd/Mtok>},"grok-4.20-non-reasoning":{...}}'`
  (no prices are hard-coded; xAI changes them)

It exits 1 when any case misses its label. A real run costs one fast-vision call and one grok-4.7
call per case (off-topic cases skip grok-4.7), so run it deliberately. `MOCK_GROK=1 LOCAL_BACKEND=1`
gives a free plumbing dry run (`--smoke` adds four built-in synthetic cases). `--only <text>` runs
only the cases whose name contains the text.

## Layout

```
test/fixtures/
  positive/<case>/          genuine captures that should be accepted
    0.jpg 1.jpg 2.jpg       the burst, in capture order (numeric filename order)
    label.json
  negative/<case>/          anything that must not be accepted (off-topic, screen, print, fake…)
    0.jpg 1.jpg 2.jpg
    label.json
```

`label.json`:

```json
{
  "expected_status": "rejected",
  "expected_codes": ["OFF_TOPIC"],
  "notes": "Tester aimed at a vitamin-water bottle on a street-flood bounty (incident 2026-09-26).",
  "lat": 33.7756, "lng": -84.3963, "captured_at": "2026-09-26T15:10:00Z",
  "protocol": "street-flood-depth"
}
```

- `expected_status`: `accepted` | `needs_review` | `rejected`. Defaults: positive → accepted,
  negative → rejected.
- `expected_codes` (optional): reason codes that must all be present.
- `lat`, `lng`, `captured_at`: where and when it was captured. Defaults are the demo location and now.
  Precipitation is checked against Open-Meteo for that place and time unless `DEMO_MODE=1` (waived)
  or `OFFLINE_CONTEXT=1` (skipped).
- `protocol`: slug, default `street-flood-depth`.
- `mockVariant` (optional): only used with `MOCK_GROK=1` (for example `off_topic`).

Each case is judged against a bounty centred on it and open around its capture time, so the eval
measures the visual layers (relevance, challenge, protocol and extraction sanity, authenticity,
daylight), not geography. Session integrity (including the server-side capture gate), duplicates,
velocity and corroboration have no history in eval runs.

The older layout still loads: any directory with `meta.json` `{"expected": "genuine" | "fake"}`
(genuine = must be accepted, fake = must not be). `generated/…` is written by
`scripts/generate-examples.ts --negatives N` and is gitignored.

## Pulling a real submission into a fixture

```
cd apps/web
npx tsx --env-file=.env scripts/pull-submission-fixture.ts <submissionId|prefix> <positive|negative> <caseName> [--expect <status>] [--force]
# the incident capture:
npx tsx --env-file=.env scripts/pull-submission-fixture.ts cecbc0a4 negative vitamin-water-bottle
```

It reads the submission over `DATABASE_URL` and its frames from Supabase Storage using the service
role (`SUPABASE_SERVICE_ROLE_KEY`), or from PGlite and local storage with `LOCAL_BACKEND=1`. It never
writes to the database or storage and never prints keys. `label.json` gets the capture's place,
time, protocol and previous outcome. `MOCK_GROK` must be 0 (mock mode is refused on a real DB).
**Real photos can show bystanders, faces, plates and addresses: look at them before committing.**

## What to add (human TODO)

About 20 real bursts taken with the app (3 frames, ~600 ms apart, doing the challenge movement):
- positive: shallow water against a curb, tire or ruler that meets the protocol, in day and dusk
  light. Blurry or badly framed honest shots are expected to get a retryable protocol reject;
  keep them out of `positive/` so the accept-rate target stays meaningful.
- negative: off-topic subjects (bottle, desk, face), a flood photo on a laptop screen, a printed
  photo, one generated image repeated as 3 frames, a dry street.
