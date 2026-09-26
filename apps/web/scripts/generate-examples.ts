/**
 * Grok Imagine assets:
 *   pnpm generate:examples                 # example "ideal shot" for every published protocol missing one
 *   pnpm generate:examples --force         # regenerate them
 *   pnpm generate:examples --negatives 5   # + 5 red-team negatives into test/fixtures/generated/ (eval set)
 * Backend: LOCAL_BACKEND=1 (stop `next dev` first: PGlite is single-process) or DATABASE_URL + Supabase keys.
 * MOCK_GROK=1 produces deterministic placeholder images.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEMO } from "@groundtruth/shared";
import { getDb } from "../lib/db";
import { getBounty } from "../lib/db/repos/bounties";
import { listProtocols } from "../lib/db/repos/protocols";
import { generateExampleImage } from "../lib/examples";
import { grokImage } from "../lib/grok/imagine";
import { fakePrompt } from "../lib/redteam";
import { getStorage } from "../lib/storage";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const negatives = Number(argValue("--negatives") ?? 0);
  const db = await getDb();
  const storage = getStorage();
  const protocols = (await listProtocols(db, DEMO.researcherId, true)).filter((p) => p.status === "published");

  for (const p of protocols) {
    const r = await generateExampleImage(db, storage, p, { force });
    console.log(`${r.generated ? "generated" : "exists   "} ${p.slug} → ${r.path}`);
  }

  if (negatives > 0) {
    const flood = protocols.find((p) => p.slug === "street-flood-depth") ?? protocols[0];
    const bounty = await getBounty(db, DEMO.bountyId);
    if (!flood || !bounty) throw new Error("seeded protocol/bounty missing: run demo:reset");
    const root = resolve(process.cwd(), "test", "fixtures", "generated");
    for (let i = 0; i < negatives; i++) {
      const prompt = `${fakePrompt(bounty, flood)} Variation ${i + 1}.`;
      const img = await grokImage({ prompt, aspectRatio: "4:3" });
      const dir = join(root, `${flood.slug}-fake-${String(i + 1).padStart(2, "0")}`);
      mkdirSync(dir, { recursive: true });
      // A generated image submitted as the whole burst: what a cheater with one fake would send.
      for (let f = 0; f < 3; f++) writeFileSync(join(dir, `${f}.jpg`), img);
      writeFileSync(join(dir, "meta.json"), JSON.stringify({ expected: "fake", protocol: flood.slug, mockVariant: "ai_generated", prompt }, null, 2));
      console.log(`negative ${i + 1}/${negatives} → ${dir}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
