/**
 * Red-team console (PRD §7.8): attack our own verification through the same pipeline, skipping
 * only the live-session requirement. Results go to redteam_runs (+ synthetic_media for generated
 * images) and NEVER to submissions.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  cellForPoint,
  pickChallenge,
  type AttackType,
  type MockVariant,
  type RedteamRunResponse,
} from "@groundtruth/shared";
import { mediaUrl } from "./api/views";
import type { Db } from "./db";
import type { BountyRow } from "./db/repos/bounties";
import type { ProtocolRow } from "./db/repos/protocols";
import { insertRedteamRun, insertSyntheticMedia } from "./db/repos/redteam";
import { latestAccepted } from "./db/repos/submissions";
import { grokEnv } from "./grok/config";
import { grokImage } from "./grok/imagine";
import type { ObjectStorage } from "./storage";
import { memorySink, runPipeline } from "./verification/pipeline";
import type { PipelineDeps, PipelineFrame } from "./verification/types";
import { HttpError } from "./api/http";

export function fakePrompt(bounty: Pick<BountyRow, "title" | "summary">, protocol: ProtocolRow): string {
  return [
    "Candid, unedited smartphone photo taken by a pedestrian, landscape orientation, slight motion blur and phone-camera noise.",
    `Scene: ${bounty.title}. ${bounty.summary}`,
    protocol.definition.example_image_prompt.replace(/Instructional reference photo\.?/i, ""),
    "It must look like a genuine field capture, not an illustration.",
  ].join(" ");
}

/** Three overlapping crops that shift left→right: fakes the parallax a real step-left burst has. */
async function pseudoBurst(bytes: Buffer): Promise<Buffer[]> {
  const meta = await sharp(bytes).metadata();
  const w = meta.width ?? 640;
  const h = meta.height ?? 480;
  const cw = Math.floor(w * 0.85);
  const ch = Math.floor(h * 0.85);
  const step = Math.floor((w - cw) / 2);
  return Promise.all(
    [0, 1, 2].map((i) =>
      sharp(bytes).extract({ left: i * step, top: Math.floor((h - ch) / 2), width: cw, height: ch }).jpeg({ quality: 85 }).toBuffer(),
    ),
  );
}

export async function runAttack(args: {
  db: Db;
  storage: ObjectStorage;
  deps: PipelineDeps;
  bounty: BountyRow;
  protocol: ProtocolRow;
  attack: AttackType;
  origin: string;
}): Promise<RedteamRunResponse> {
  const { db, storage, bounty, protocol, attack } = args;
  const runId = randomUUID();
  const now = args.deps.now();
  let frames: PipelineFrame[];
  let lat = bounty.center_lat;
  let lng = bounty.center_lng;
  let capturedAt = now.toISOString();
  let syntheticId: string | null = null;
  let sourceSubmission: string | null = null;
  let imagePath: string | null = null;
  let variant: MockVariant | undefined;

  if (attack === "ai_generated") {
    const prompt = fakePrompt(bounty, protocol);
    const img = await grokImage({ prompt, aspectRatio: "4:3" });
    imagePath = `synthetic/redteam/${runId}.jpg`;
    await storage.put(imagePath, img, "image/jpeg");
    syntheticId = await insertSyntheticMedia(db, { kind: "redteam", path: imagePath, prompt, model: grokEnv.imageModel });
    // The attacker has one generated image and submits it as the whole burst.
    frames = [0, 1, 2].map(() => ({ path: imagePath!, bytes: img }));
    variant = "ai_generated"; // only affects MOCK_GROK fixtures; the real model judges the pixels
  } else if (attack === "recycled") {
    const src = await latestAccepted(db, bounty.id);
    if (!src) throw new HttpError(409, "NO_SOURCE", "No accepted observation to recycle yet: accept one capture first");
    sourceSubmission = src.id;
    imagePath = src.media[0]?.path ?? null;
    frames = await Promise.all(src.media.map(async (m) => ({ path: m.path, bytes: await storage.get(m.path) })));
    lat = src.lat;
    lng = src.lng;
  } else {
    const prompt = `${protocol.definition.example_image_prompt} Candid smartphone photo.`;
    const img = await grokImage({ prompt: `${prompt} ${runId}`, aspectRatio: "4:3" });
    imagePath = `synthetic/redteam/${runId}.jpg`;
    await storage.put(imagePath, img, "image/jpeg");
    syntheticId = await insertSyntheticMedia(db, { kind: "redteam", path: imagePath, prompt, model: grokEnv.imageModel });
    const burst = await pseudoBurst(img);
    frames = burst.map((bytes, i) => ({ path: `synthetic/redteam/${runId}-${i}.jpg`, bytes }));
    // Spoofed metadata: ~5.5 km north of the bounty center, two days before the bounty opened.
    lat = bounty.center_lat + 0.05;
    capturedAt = new Date(Date.parse(bounty.starts_at) - 2 * 86_400_000).toISOString();
  }

  const result = await runPipeline(
    {
      source: "redteam",
      submissionId: null,
      userId: null,
      frames,
      lat,
      lng,
      accuracy_m: 5,
      captured_at: capturedAt,
      received_at: now.toISOString(),
      nonce: null,
      device: { model: "redteam", os: "redteam" },
      sensors: {},
      gate: {},
      field_notes: {},
      h3_cell: cellForPoint(lat, lng),
      bounty: { id: bounty.id, cells: bounty.cells, area: bounty.area, starts_at: bounty.starts_at, ends_at: bounty.ends_at },
      protocol: protocol.definition,
      session: null,
      challenge: pickChallenge(protocol.definition),
      trustScore: 0.5,
      ...(variant ? { mockVariant: variant } : {}),
    },
    args.deps,
    memorySink(),
  );
  const status = result.decision.status;
  const caught = status !== "accepted";
  const id = await insertRedteamRun(db, {
    bounty_id: bounty.id,
    attack_type: attack,
    synthetic_media_id: syntheticId,
    source_submission_id: sourceSubmission,
    pipeline_result: {
      status,
      reason_codes: result.decision.reasonCodes,
      checks: result.checks,
      confidence: result.decision.confidence,
      image_path: imagePath,
    },
    caught,
  });
  return {
    run_id: id,
    attack_type: attack,
    caught,
    status,
    reason_codes: result.decision.reasonCodes,
    image_url: await mediaUrl(imagePath, args.origin),
  };
}
