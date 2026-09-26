import { Uuid, type BriefingVideoResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { loadManagedBounty } from "@/lib/api/bountyAccess";
import { grokUnavailable, json, route, type IdParams } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { completeBriefingVideo, startBriefingVideo } from "@/lib/briefing";
import { getDb } from "@/lib/db";
import { GrokError } from "@/lib/grok/config";
import { getStorage } from "@/lib/storage";

// Vercel Hobby caps functions at 300 s (Pro: 800). A clip that takes longer is cut off; retry
// the route, or pre-generate clips before the demo.
export const maxDuration = 300;

/** Starts a Grok Imagine briefing clip; polling + storage continue after the response (can take minutes). */
export const POST = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const user = await requireUser(req);
  const db = await getDb();
  const { bounty, protocol } = await loadManagedBounty(db, user, id);
  let started;
  try {
    started = await startBriefingVideo(bounty, protocol);
  } catch (err) {
    if (err instanceof GrokError || err instanceof Error) throw grokUnavailable(err, "briefing video");
    throw err;
  }
  runInBackground(async () => {
    const outcome = await completeBriefingVideo(await getDb(), getStorage(), { bountyId: bounty.id, ...started });
    console.info(`[briefing] ${bounty.id} ${started.requestId}: ${outcome}`);
  });
  const body: z.infer<typeof BriefingVideoResponseSchema> = { request_id: started.requestId, status: "pending" };
  return json(body, { status: 202 });
});
