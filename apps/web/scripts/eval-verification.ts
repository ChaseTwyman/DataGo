/**
 * Runs the real verification pipeline over apps/web/test/fixtures and prints a confusion table.
 *   pnpm eval:verification                 # real Grok (needs XAI_API_KEY)
 *   MOCK_GROK=1 pnpm eval:verification     # plumbing check with fixtures
 * See test/fixtures/README.md for the layout. With no fixtures, `--smoke` (default under
 * MOCK_GROK=1) runs three built-in synthetic cases so the script always exercises the pipeline.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  cellForPoint,
  cellsForCircle,
  circlePolygon,
  DEMO,
  streetFloodDepth,
  BUILTIN_PROTOCOLS,
  type DecisionStatus,
  type MockVariant,
} from "@groundtruth/shared";
import { isMockGrok } from "../lib/env";
import { isolatedDeps } from "../lib/verification/deps";
import { memorySink, runPipeline } from "../lib/verification/pipeline";

type Expected = "genuine" | "fake";
interface Case {
  name: string;
  expected: Expected;
  frames: Buffer[];
  lat: number;
  lng: number;
  captured_at: string;
  protocol: string;
  mockVariant?: MockVariant;
}

const FIXTURES = resolve(process.cwd(), "test", "fixtures");

function loadCases(dir: string, prefix = ""): Case[] {
  if (!existsSync(dir)) return [];
  const out: Case[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (!statSync(p).isDirectory()) continue;
    const metaPath = join(p, "meta.json");
    if (!existsSync(metaPath)) {
      out.push(...loadCases(p, `${prefix}${entry}/`));
      continue;
    }
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Partial<Case> & { expected: Expected };
    const frames = readdirSync(p)
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .sort()
      .map((f) => readFileSync(join(p, f)));
    if (frames.length === 0) continue;
    out.push({
      name: `${prefix}${entry}`,
      expected: meta.expected,
      frames,
      lat: meta.lat ?? DEMO.lat,
      lng: meta.lng ?? DEMO.lng,
      captured_at: meta.captured_at ?? new Date().toISOString(),
      protocol: meta.protocol ?? streetFloodDepth.slug,
      ...(meta.mockVariant ? { mockVariant: meta.mockVariant } : {}),
    });
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
  const base = { lat: DEMO.lat, lng: DEMO.lng, captured_at: now, protocol: streetFloodDepth.slug };
  const one = await blocks(42);
  return [
    { ...base, name: "smoke/genuine-burst", expected: "genuine", frames: [await blocks(1), await blocks(2), await blocks(3)] },
    { ...base, name: "smoke/static-image-burst", expected: "fake", frames: [one, one, one] },
    { ...base, name: "smoke/ai-generated", expected: "fake", frames: [await blocks(7), await blocks(8), await blocks(9)], mockVariant: "ai_generated" },
  ];
}

async function main(): Promise<void> {
  let cases = loadCases(FIXTURES);
  const smoke = process.argv.includes("--smoke") || (cases.length === 0 && isMockGrok());
  if (cases.length === 0 && !smoke) {
    console.log(`No fixtures under ${FIXTURES}. Add cases (see test/fixtures/README.md) or run with --smoke / MOCK_GROK=1.`);
    return;
  }
  if (smoke) cases = [...cases, ...(await smokeCases())];
  console.log(`Evaluating ${cases.length} case(s) with ${isMockGrok() ? "MOCK" : "REAL"} Grok\n`);

  const table: Record<Expected, Record<DecisionStatus, number>> = {
    genuine: { accepted: 0, needs_review: 0, rejected: 0 },
    fake: { accepted: 0, needs_review: 0, rejected: 0 },
  };
  for (const c of cases) {
    const protocol = BUILTIN_PROTOCOLS[c.protocol] ?? streetFloodDepth;
    const at = Date.parse(c.captured_at);
    // Each fixture is judged against a bounty centred on it and open around its capture time:
    // the eval measures the visual layers, not the fixture's geography.
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
        ...(c.mockVariant && isMockGrok() ? { mockVariant: c.mockVariant } : {}),
      },
      isolatedDeps(),
      memorySink(),
    );
    const d = r.decision;
    table[c.expected][d.status]++;
    const ok = c.expected === "genuine" ? d.status === "accepted" : d.status !== "accepted";
    console.log(`${ok ? "✓" : "✗"} ${c.name.padEnd(36)} expected ${c.expected.padEnd(7)} → ${d.status.padEnd(12)} conf ${d.confidence.toFixed(2)} [${d.reasonCodes.join(",")}]`);
  }

  const row = (k: Expected) =>
    `${k.padEnd(9)}| ${String(table[k].accepted).padStart(8)} | ${String(table[k].needs_review).padStart(12)} | ${String(table[k].rejected).padStart(8)}`;
  console.log(`\nConfusion (rows = truth, cols = decision)\n${"".padEnd(9)}| accepted | needs_review | rejected\n${row("genuine")}\n${row("fake")}`);
  const g = table.genuine;
  const f = table.fake;
  const gTotal = g.accepted + g.needs_review + g.rejected;
  const fTotal = f.accepted + f.needs_review + f.rejected;
  if (gTotal) console.log(`honest accepted first try: ${((100 * g.accepted) / gTotal).toFixed(0)}% (target ≥ 80%)`);
  if (fTotal) console.log(`fakes caught (rejected or review): ${((100 * (fTotal - f.accepted)) / fTotal).toFixed(0)}% (target 100%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
