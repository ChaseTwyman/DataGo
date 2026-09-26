/**
 * Writes N labelled NEGATIVE eval fixtures from Grok Imagine, without a database:
 *   test/fixtures/negative/imagine-pseudo-burst-<n>/{0,1,2}.jpg + meta.json {"expected":"fake"}
 *
 * Each case is the red team's "pseudo-parallax" attack with provenance stripped: one generated
 * street-flood image cut into three overlapping, shifted crops and re-encoded (sharp drops the C2PA
 * manifest). The deterministic checks (identical-burst dHash, C2PA label) cannot catch it, so the
 * grok-4.7 verification call is what has to — which makes these the cases that measure whether a
 * latency setting weakens model-side detection.
 *
 *   npx tsx --env-file=<.env with XAI_API_KEY> scripts/make-imagine-negatives.ts 2
 * Costs N image generations. Look at the output before committing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { DEMO, streetFloodDepth } from "@groundtruth/shared";
import { grokImage } from "../lib/grok/imagine";
import { pseudoBurst } from "../lib/redteam";

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 2);
  const root = resolve(process.cwd(), "test", "fixtures", "negative");
  for (let i = 1; i <= n; i++) {
    const prompt = [
      "Candid, unedited smartphone photo taken by a pedestrian, landscape orientation, slight motion blur and phone-camera noise.",
      "Scene: a flash flood on a city street after a storm.",
      streetFloodDepth.example_image_prompt.replace(/Instructional reference photo\.?/i, ""),
      `It must look like a genuine field capture, not an illustration. Variation ${i}.`,
    ].join(" ");
    const img = await grokImage({ prompt, aspectRatio: "4:3" });
    // Upscaled to the phone's upload size (2048 px long edge, like the real vitamin-water capture) so
    // the model sees production-sized frames after toModelFrame and token counts are representative.
    const frames = await Promise.all(
      (await pseudoBurst(img)).map((f) => sharp(f).resize(2048, 1536, { fit: "fill" }).jpeg({ quality: 88 }).toBuffer()),
    );
    const dir = join(root, `imagine-pseudo-burst-${i}`);
    mkdirSync(dir, { recursive: true });
    frames.forEach((f, k) => writeFileSync(join(dir, `${k}.jpg`), f));
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify(
        {
          expected: "fake",
          protocol: streetFloodDepth.slug,
          lat: DEMO.lat,
          lng: DEMO.lng,
          notes: "Grok Imagine image → 3 shifted crops, re-encoded (C2PA stripped). Must not be accepted.",
          prompt,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`negative ${i}/${n} → ${dir}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
