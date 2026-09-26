/**
 * Runs the REAL verification pipeline (relevance + grok-4.7 + context, source "eval") over labelled
 * fixtures and prints a confusion table, per-stage timings and token usage / cost.
 *
 *   pnpm eval:verification                  # real Grok (needs XAI_API_KEY). Costs money: ~1 fast +
 *                                           # 1 reasoning call per case.
 *   MOCK_GROK=1 LOCAL_BACKEND=1 pnpm eval:verification   # plumbing dry run with fixtures (free)
 *   ... --only negative/vitamin-water       # run the cases whose name contains the string
 *   ... --smoke                             # add three built-in synthetic cases
 *
 * Layout (test/fixtures/README.md):
 *   test/fixtures/{positive,negative}/<case>/{0,1,2}.jpg + label.json
 *   label.json: {"expected_status": "accepted"|"needs_review"|"rejected", "expected_codes"?: [...],
 *                "notes"?: "...", "lat"?, "lng"?, "captured_at"?, "protocol"?, "mockVariant"?}
 * The older layout (any dir with meta.json {"expected": "genuine"|"fake"}) still loads.
 * Pull a stored submission into this layout with scripts/pull-submission-fixture.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  BUILTIN_PROTOCOLS,
  cellForPoint,
  cellsForCircle,
  circlePolygon,
  DEMO,
  STAGES,
  streetFloodDepth,
  type DecisionStatus,
  type MockVariant,
  type ReasonCode,
} from "@groundtruth/shared";
import { isMockGrok } from "../lib/env";
import { setGrokLogSink, type GrokCallLog } from "../lib/grok/log";
import { isolatedDeps } from "../lib/verification/deps";
import { memorySink, runPipeline } from "../lib/verification/pipeline";

type Truth = "positive" | "negative";
interface Case {
  name: string;
  truth: Truth;
  /** Expected pipeline status; null for legacy meta.json cases (then: positive ⇒ accepted, negative ⇒ not accepted). */
  expectedStatus: DecisionStatus | null;
  expectedCodes: string[];
  notes: string;
  frames: Buffer[];
  lat: number;
  lng: number;
  captured_at: string;
  protocol: string;
  mockVariant?: MockVariant;
}

interface Label {
  expected_status?: DecisionStatus;
  expected_codes?: string[];
  notes?: string;
  lat?: number;
  lng?: number;
  captured_at?: string;
  protocol?: string;
  mockVariant?: MockVariant;
}

const FIXTURES = resolve(process.cwd(), "test", "fixtures");
const STATUSES: DecisionStatus[] = ["accepted", "needs_review", "rejected"];

function frameFiles(dir: string): Buffer[] {
  return readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => readFileSync(join(dir, f)));
}

function loadCases(dir: string, prefix = ""): Case[] {
  if (!existsSync(dir)) return [];
  const out: Case[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (!statSync(p).isDirectory()) continue;
    const name = `${prefix}${entry}`;
    const labelPath = join(p, "label.json");
    const metaPath = join(p, "meta.json");
    if (existsSync(labelPath)) {
      const top = name.split("/")[0];
      if (top !== "positive" && top !== "negative") {
        console.warn(`skip ${name}: label.json cases must live under positive/ or negative/`);
        continue;
      }
      const l = JSON.parse(readFileSync(labelPath, "utf8")) as Label;
      const frames = frameFiles(p);
      if (frames.length === 0) continue;
      out.push({
        name,
        truth: top,
        expectedStatus: l.expected_status ?? (top === "positive" ? "accepted" : "rejected"),
        expectedCodes: l.expected_codes ?? [],
        notes: l.notes ?? "",
        frames,
        lat: l.lat ?? DEMO.lat,
        lng: l.lng ?? DEMO.lng,
        captured_at: l.captured_at ?? new Date().toISOString(),
        protocol: l.protocol ?? streetFloodDepth.slug,
        ...(l.mockVariant ? { mockVariant: l.mockVariant } : {}),
      });
    } else if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Label & { expected: "genuine" | "fake" };
      const frames = frameFiles(p);
      if (frames.length === 0) continue;
      out.push({
        name,
        truth: meta.expected === "genuine" ? "positive" : "negative",
        expectedStatus: null,
        expectedCodes: [],
        notes: "",
        frames,
        lat: meta.lat ?? DEMO.lat,
        lng: meta.lng ?? DEMO.lng,
        captured_at: meta.captured_at ?? new Date().toISOString(),
        protocol: meta.protocol ?? streetFloodDepth.slug,
        ...(meta.mockVariant ? { mockVariant: meta.mockVariant } : {}),
      });
    } else {
      out.push(...loadCases(p, `${name}/`));
    }
  }
  return out;
}

async function blocks(seed: number): Promise<Buffer> {
  let a = seed >>> 0;
  const rand = () => ((a = (Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  const w = 480;
  const h = 360;
  const raw = Buffer.alloc(w * h * 3);
  const cols = Math.ceil(w / 40);
  const pal = Array.from({ length: cols * Math.ceil(h / 40) }, () => [rand() * 255, rand() * 255, rand() * 255]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set(pal[Math.floor(y / 40) * cols + Math.floor(x / 40)]!.map(Math.floor), (y * w + x) * 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}

async function smokeCases(): Promise<Case[]> {
  const now = new Date().toISOString();
  const base = { lat: DEMO.lat, lng: DEMO.lng, captured_at: now, protocol: streetFloodDepth.slug, expectedCodes: [], notes: "" };
  const one = await blocks(42);
  return [
    { ...base, name: "smoke/genuine-burst", truth: "positive", expectedStatus: "accepted", frames: [await blocks(1), await blocks(2), await blocks(3)] },
    { ...base, name: "smoke/static-image-burst", truth: "negative", expectedStatus: "rejected", frames: [one, one, one] },
    { ...base, name: "smoke/ai-generated", truth: "negative", expectedStatus: "rejected", frames: [await blocks(7), await blocks(8), await blocks(9)], mockVariant: "ai_generated" },
    { ...base, name: "smoke/off-topic", truth: "negative", expectedStatus: "rejected", expectedCodes: ["OFF_TOPIC"], frames: [await blocks(11), await blocks(12), await blocks(13)], mockVariant: "off_topic" },
  ];
}

/** USD per million tokens, from EVAL_PRICES='{"grok-4.7":{"in":3,"out":15}}'. No built-in prices: they change. */
function prices(): Record<string, { in: number; out: number }> {
  try {
    return process.env.EVAL_PRICES ? (JSON.parse(process.env.EVAL_PRICES) as Record<string, { in: number; out: number }>) : {};
  } catch {
    console.warn("EVAL_PRICES is not valid JSON; cost will not be estimated");
    return {};
  }
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  let cases = loadCases(FIXTURES);
  const only = argValue("--only");
  if (only) cases = cases.filter((c) => c.name.includes(only));
  const smoke = process.argv.includes("--smoke") || (cases.length === 0 && isMockGrok());
  if (cases.length === 0 && !smoke) {
    console.log(`No fixtures under ${FIXTURES}. Add cases (see test/fixtures/README.md) or run with --smoke / MOCK_GROK=1.`);
    return;
  }
  if (smoke) cases = [...cases, ...(await smokeCases())];
  const mock = isMockGrok();
  console.log(`Evaluating ${cases.length} case(s) with ${mock ? "MOCK (fixtures, free)" : "REAL"} Grok\n`);

  // Token usage per model, from the grok call log (every call is logged with usage).
  const calls: GrokCallLog[] = [];
  const prevSink = setGrokLogSink((e) => calls.push(e));

  const table: Record<DecisionStatus, Record<DecisionStatus, number>> = {
    accepted: { accepted: 0, needs_review: 0, rejected: 0 },
    needs_review: { accepted: 0, needs_review: 0, rejected: 0 },
    rejected: { accepted: 0, needs_review: 0, rejected: 0 },
  };
  const byTruth: Record<Truth, Record<DecisionStatus, number>> = {
    positive: { accepted: 0, needs_review: 0, rejected: 0 },
    negative: { accepted: 0, needs_review: 0, rejected: 0 },
  };
  const stageMs = new Map<string, number[]>();
  const totalMs: number[] = [];
  let failures = 0;

  for (const c of cases) {
    const protocol = BUILTIN_PROTOCOLS[c.protocol] ?? streetFloodDepth;
    const at = Date.parse(c.captured_at);
    const t0 = Date.now();
    // Each fixture is judged against a bounty centred on it and open around its capture time: the
    // eval measures the visual layers, not the fixture's geography.
    const r = await runPipeline(
      {
        source: "eval",
        submissionId: null,
        userId: null,
        frames: c.frames.map((bytes, i) => ({ path: `observations/eval/${c.name}/${i}.jpg`, bytes })),
        lat: c.lat,
        lng: c.lng,
        accuracy_m: 5,
        captured_at: c.captured_at,
        received_at: c.captured_at,
        nonce: null,
        device: { os: "eval" },
        sensors: {},
        gate: {},
        field_notes: {},
        h3_cell: cellForPoint(c.lat, c.lng),
        bounty: {
          id: DEMO.bountyId,
          cells: cellsForCircle(c.lat, c.lng, 500),
          area: circlePolygon(c.lat, c.lng, 500),
          starts_at: new Date(at - 86_400_000).toISOString(),
          ends_at: new Date(at + 86_400_000).toISOString(),
        },
        protocol,
        session: null,
        challenge: protocol.capture.challenges[0]!,
        trustScore: 0.5,
        ...(c.mockVariant && mock ? { mockVariant: c.mockVariant } : {}),
      },
      isolatedDeps(),
      memorySink(),
    );
    const ms = Date.now() - t0;
    totalMs.push(ms);
    for (const s of r.checks) stageMs.set(s.stage, [...(stageMs.get(s.stage) ?? []), s.ms]);
    const d = r.decision;
    byTruth[c.truth][d.status]++;
    const expected = c.expectedStatus ?? (c.truth === "positive" ? "accepted" : null);
    if (expected) table[expected][d.status]++;
    const statusOk = expected ? d.status === expected : d.status !== "accepted";
    const missingCodes = c.expectedCodes.filter((code) => !d.reasonCodes.includes(code as ReasonCode));
    const ok = statusOk && missingCodes.length === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? "✓" : "✗"} ${c.name.padEnd(40)} expected ${(expected ?? "not accepted").padEnd(12)} → ${d.status.padEnd(12)} ` +
        `conf ${d.confidence.toFixed(2)} ${(ms / 1000).toFixed(1)}s [${d.reasonCodes.join(",")}]` +
        (missingCodes.length ? ` missing codes: ${missingCodes.join(",")}` : "") +
        (c.notes ? `\n    ${c.notes}` : ""),
    );
    const relevance = r.checks.find((s) => s.stage === "relevance");
    if (relevance && relevance.status !== "pass") console.log(`    relevance ${relevance.status}: ${relevance.evidence.join(" | ")}`);
  }
  setGrokLogSink(prevSink);

  const pad = (v: number | string, n: number) => String(v).padStart(n);
  console.log(`\nConfusion (rows = expected status, cols = decision)\n${"".padEnd(14)}| accepted | needs_review | rejected`);
  for (const k of STATUSES) {
    const row = table[k];
    if (row.accepted + row.needs_review + row.rejected === 0) continue;
    console.log(`${k.padEnd(14)}| ${pad(row.accepted, 8)} | ${pad(row.needs_review, 12)} | ${pad(row.rejected, 8)}`);
  }
  const g = byTruth.positive;
  const f = byTruth.negative;
  const gTotal = g.accepted + g.needs_review + g.rejected;
  const fTotal = f.accepted + f.needs_review + f.rejected;
  if (gTotal) console.log(`positives accepted first try: ${((100 * g.accepted) / gTotal).toFixed(0)}% (target ≥ 80%)`);
  if (fTotal) console.log(`negatives caught (rejected or review): ${((100 * (fTotal - f.accepted)) / fTotal).toFixed(0)}% (target 100%)`);

  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)]! : 0;
  };
  console.log("\nPer-stage time (median / max, ms)");
  for (const s of STAGES) {
    const xs = stageMs.get(s.id) ?? [];
    console.log(`  ${s.id.padEnd(18)} ${pad(med(xs), 7)} / ${pad(xs.length ? Math.max(...xs) : 0, 7)}`);
  }
  console.log(`  ${"total".padEnd(18)} ${pad(med(totalMs), 7)} / ${pad(totalMs.length ? Math.max(...totalMs) : 0, 7)}`);

  const usage = new Map<string, { calls: number; ok: number; in: number; out: number; ms: number }>();
  for (const e of calls) {
    const k = `${e.op} ${e.model}${e.mock ? " (mock)" : ""}`;
    const u = usage.get(k) ?? { calls: 0, ok: 0, in: 0, out: 0, ms: 0 };
    u.calls++;
    if (e.ok) u.ok++;
    u.in += e.usage?.input_tokens ?? 0;
    u.out += e.usage?.output_tokens ?? 0;
    u.ms += e.ms;
    usage.set(k, u);
  }
  const p = prices();
  let cost = 0;
  let priced = true;
  console.log("\nGrok calls (from the call log)");
  for (const [k, u] of usage) {
    const model = k.split(" ")[1]!;
    const price = p[model];
    const usd = price ? (u.in * price.in + u.out * price.out) / 1e6 : null;
    if (usd === null && !k.endsWith("(mock)")) priced = false;
    cost += usd ?? 0;
    console.log(`  ${k.padEnd(48)} ${u.ok}/${u.calls} ok  in ${pad(u.in, 8)}  out ${pad(u.out, 7)}  avg ${Math.round(u.ms / u.calls)} ms${usd !== null ? `  $${usd.toFixed(4)}` : ""}`);
  }
  if (mock) console.log("  (mock run: no tokens, no cost)");
  else if (priced) console.log(`  estimated cost: $${cost.toFixed(4)} total, $${(cost / Math.max(1, cases.length)).toFixed(4)} per case`);
  else console.log('  set EVAL_PRICES=\'{"<model>":{"in":<usd per Mtok>,"out":<usd per Mtok>}}\' for a cost estimate (xAI prices change; none are hard-coded)');

  if (failures > 0) {
    console.log(`\n${failures} case(s) did not match their label`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
