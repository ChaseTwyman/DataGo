/**
 * Briefing video (P1): Grok Imagine video (7 s, 9:16, 720p) started on request, polled in the
 * background, downloaded (hosted URLs are temporary) into the synthetic bucket, and linked to the bounty.
 */
import type { Db } from "./db";
import type { BountyRow } from "./db/repos/bounties";
import type { ProtocolRow } from "./db/repos/protocols";
import { insertSyntheticMedia } from "./db/repos/redteam";
import { grokEnv } from "./grok/config";
import { grokVideoPoll, grokVideoStart } from "./grok/imagine";
import type { ObjectStorage } from "./storage";

export function briefingPrompt(b: Pick<BountyRow, "title" | "summary">, p: ProtocolRow): string {
  return [
    `Vertical 7-second mission briefing clip for citizen scientists: ${b.title}.`,
    b.summary,
    `Show what a good capture looks like: ${p.definition.example_image_prompt}`,
    `Calm, safe framing: the person stays on dry ground, well away from hazards. ${p.definition.safety.rules[0] ?? ""}`,
  ].join(" ");
}

export async function setBriefingVideoPath(db: Db, bountyId: string, path: string): Promise<void> {
  await db.query("update public.bounties set briefing_video_path = $2 where id = $1", [bountyId, path]);
}

export async function startBriefingVideo(bounty: BountyRow, protocol: ProtocolRow): Promise<{ requestId: string; prompt: string }> {
  const prompt = briefingPrompt(bounty, protocol);
  const { requestId } = await grokVideoStart({ prompt, duration: 7, aspectRatio: "9:16", resolution: "720p" });
  return { requestId, prompt };
}

/** Polls until done/failed/expired or the deadline, then stores the file. Runs in the background. */
export async function completeBriefingVideo(
  db: Db,
  storage: ObjectStorage,
  args: {
    bountyId: string;
    requestId: string;
    prompt: string;
    intervalMs?: number;
    deadlineMs?: number;
    fetchImpl?: (url: string) => Promise<Response>;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<"stored" | "failed" | "no_url" | "timeout"> {
  const sleep = args.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const fetchImpl = args.fetchImpl ?? ((u: string) => fetch(u));
  const deadline = Date.now() + (args.deadlineMs ?? 15 * 60_000);
  for (;;) {
    const r = await grokVideoPoll(args.requestId);
    if (r.status === "done") {
      if (!r.url) return "no_url";
      const res = await fetchImpl(r.url);
      if (!res.ok) throw new Error(`video download HTTP ${res.status}`);
      const path = `synthetic/briefings/${args.bountyId}.mp4`;
      await storage.put(path, Buffer.from(await res.arrayBuffer()), "video/mp4");
      await insertSyntheticMedia(db, { kind: "briefing", path, prompt: args.prompt, model: grokEnv.videoModel });
      await setBriefingVideoPath(db, args.bountyId, path);
      return "stored";
    }
    if (r.status === "failed" || r.status === "expired") {
      console.warn(`[briefing] video ${args.requestId} ${r.status}: ${"error" in r ? (r.error ?? "") : ""}`);
      return "failed";
    }
    if (Date.now() > deadline) return "timeout";
    await sleep(args.intervalMs ?? 10_000);
  }
}
