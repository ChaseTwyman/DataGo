/**
 * Downloads a stored submission's frames into the eval fixture layout:
 *   test/fixtures/<positive|negative>/<caseName>/{0,1,2}.jpg + label.json
 *
 *   npx tsx --env-file=.env scripts/pull-submission-fixture.ts <submissionId|prefix> <positive|negative> <caseName> [--expect <status>] [--force]
 *   e.g. ... scripts/pull-submission-fixture.ts cecbc0a4 negative vitamin-water-bottle
 *
 * Reads the submission over DATABASE_URL and the frames from Supabase Storage with the service role
 * (SUPABASE_SERVICE_ROLE_KEY), or from PGlite + local storage when LOCAL_BACKEND=1. Read-only: it
 * writes nothing to the database or storage. Never prints keys or URLs.
 *
 * label.json gets the capture's place and time (so context checks see the real weather/daylight)
 * and the expected status (positive → accepted, negative → rejected, override with --expect).
 * Real photos can show bystanders and addresses: review them before committing a fixture.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DecisionStatus } from "@groundtruth/shared";
import { getDb } from "../lib/db";
import { getStorage } from "../lib/storage";

interface Row {
  id: string;
  status: string;
  reason_codes: string[];
  lat: number;
  lng: number;
  captured_at: unknown;
  media: { path: string }[];
  protocol_slug: string;
}

const STATUSES: DecisionStatus[] = ["accepted", "needs_review", "rejected"];

function usage(msg: string): never {
  console.error(`${msg}\nusage: pull-submission-fixture.ts <submissionId|prefix> <positive|negative> <caseName> [--expect accepted|needs_review|rejected] [--force]`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [idArg, truth, caseName] = process.argv.slice(2);
  if (!idArg || !/^[0-9a-f-]{6,36}$/i.test(idArg)) usage("submission id (or a ≥ 6-char prefix) required");
  if (truth !== "positive" && truth !== "negative") usage("second argument must be positive or negative");
  if (!caseName || !/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(caseName)) usage("caseName must be a simple directory name");
  const ei = process.argv.indexOf("--expect");
  const expect = (ei >= 0 ? process.argv[ei + 1] : truth === "positive" ? "accepted" : "rejected") as DecisionStatus;
  if (!STATUSES.includes(expect)) usage(`--expect must be one of ${STATUSES.join(", ")}`);

  const dir = resolve(process.cwd(), "test", "fixtures", truth, caseName);
  if (existsSync(dir) && !process.argv.includes("--force")) usage(`${dir} already exists (use --force to overwrite)`);

  const db = await getDb();
  const rows = await db.query<Row>(
    `select s.id, s.status::text as status, s.reason_codes, s.lat, s.lng, s.captured_at, s.media, p.slug as protocol_slug
       from public.submissions s
       join public.bounties b on b.id = s.bounty_id
       join public.protocols p on p.id = b.protocol_id
      where s.id::text like $1 || '%'
      limit 2`,
    [idArg.toLowerCase()],
  );
  if (rows.length === 0) usage(`no submission matches ${idArg}`);
  if (rows.length > 1) usage(`${idArg} is ambiguous; give more of the id`);
  const s = rows[0]!;
  const media = typeof s.media === "string" ? (JSON.parse(s.media) as Row["media"]) : s.media;
  if (!Array.isArray(media) || media.length === 0) usage(`submission ${s.id.slice(0, 8)} has no media (seed rows have none)`);

  const storage = getStorage();
  const frames: Buffer[] = [];
  for (const m of media) {
    if (!m.path.startsWith("observations/")) usage(`refusing non-observation media path for ${s.id.slice(0, 8)}`);
    frames.push(await storage.get(m.path));
  }

  mkdirSync(dir, { recursive: true });
  frames.forEach((b, i) => writeFileSync(join(dir, `${i}.jpg`), b));
  const capturedAt = s.captured_at instanceof Date ? s.captured_at.toISOString() : new Date(String(s.captured_at)).toISOString();
  const label = {
    expected_status: expect,
    notes: `Pulled from submission ${s.id.slice(0, 8)} (was ${s.status}${s.reason_codes.length ? `: ${s.reason_codes.join(", ")}` : ""}).`,
    lat: Number(s.lat),
    lng: Number(s.lng),
    captured_at: capturedAt,
    protocol: s.protocol_slug,
  };
  writeFileSync(join(dir, "label.json"), `${JSON.stringify(label, null, 2)}\n`);
  console.log(`[pull-fixture] wrote ${frames.length} frame(s) + label.json to test/fixtures/${truth}/${caseName} (expected ${expect})`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[pull-fixture]", err instanceof Error ? err.message : err);
    process.exit(1);
  });
