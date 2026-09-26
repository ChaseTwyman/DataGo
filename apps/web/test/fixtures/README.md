# Verification fixtures

`pnpm eval:verification` runs the real pipeline (`runPipeline`, source `eval`) over every case here and
prints a confusion table (truth × decision). Targets from PRD §5: honest captures accepted ≥ 80%,
fakes rejected or sent to review 100%.

## Layout

One directory per case, any depth. A case is a directory containing `meta.json` plus 1–6 frames
(`*.jpg` / `*.png`, used in filename order as the burst):

```
test/fixtures/
  genuine/curb-rain-01/
    meta.json        {"expected": "genuine", "lat": 33.7756, "lng": -84.3963, "captured_at": "2026-09-26T15:10:00Z"}
    0.jpg 1.jpg 2.jpg
  fake/laptop-screen-01/
    meta.json        {"expected": "fake"}
    0.jpg 1.jpg 2.jpg
  generated/…        written by scripts/generate-examples.ts --negatives N (gitignored)
```

`meta.json` fields: `expected` (`genuine` | `fake`, required), `lat`, `lng`, `captured_at` (ISO; defaults:
demo location, now), `protocol` (slug, default `street-flood-depth`), `mockVariant` (only used with
`MOCK_GROK=1`).

Each case is judged against a bounty centred on it and open around its capture time, so the eval
measures the visual layers (challenge, protocol, authenticity, daylight), not geography. Duplicates,
velocity, and corroboration have no history in eval runs. Precipitation is checked against Open-Meteo
for the case's place and time unless `DEMO_MODE=1` (waived) or `OFFLINE_CONTEXT=1` (skipped).

## What to add (human TODO)

~20 real photos taken with the app's burst (3 frames, ~600 ms apart, doing the challenge movement):
- genuine: shallow water against a curb / tire / ruler that meets the protocol, day and dusk
  (blurry or badly framed honest shots are expected to be rejected as retryable protocol failures;
  keep them out of `genuine/` so the accept-rate target stays meaningful)
- fake: a flood photo on a laptop screen, a printed photo, one generated image repeated as 3 frames
