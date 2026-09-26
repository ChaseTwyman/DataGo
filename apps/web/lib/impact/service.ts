/**
 * Impact card for one accepted submission (owner only), cached per submission in `impact_cards`
 * and stored in the synthetic bucket (never the observations bucket; never the raw photo).
 *
 * AI backgrounds are cost-capped twice: backgrounds come from a small shared pool generated from one
 * fixed prompt (at most BG_POOL Grok Imagine calls ever, then reused), and a daily cap on new
 * generations. Any Imagine failure or cap falls back to the plain card with a note — never an error.
 */
import { createHash } from "node:crypto";
import type { Db } from "../db";
import { getBounty } from "../db/repos/bounties";
import { getProtocol } from "../db/repos/protocols";
import { insertSyntheticMedia } from "../db/repos/redteam";
import { getSubmission } from "../db/repos/submissions";
import { grokEnv } from "../grok/config";
import { grokImage } from "../grok/imagine";
import { conflict, notFound } from "../api/http";
import type { ObjectStorage } from "../storage";
import { BACKGROUND_PROMPT, composeCard, impactFacts } from "./card";

export const BG_POOL = 4;
const DAILY_AI_CAP = () => Math.max(0, Number(process.env.IMPACT_AI_DAILY_CAP ?? 10) || 0);

export interface ImpactCardResult {
  path: string;
  ai_background: boolean;
  cached: boolean;
  note: string | null;
}

export const cardPath = (submissionId: string, ai: boolean) => `synthetic/impact/${submissionId}${ai ? "-ai" : ""}.jpg`;
export const backgroundPath = (slot: number) => `synthetic/impact/backgrounds/${slot}.jpg`;

export interface ImpactDeps {
  /** Injectable for tests (defaults to Grok Imagine). */
  generateBackground?: () => Promise<Buffer>;
  now?: Date;
}

export async function impactCard(
  db: Db,
  storage: ObjectStorage,
  userId: string,
  submissionId: string,
  opts: { ai: boolean },
  deps: ImpactDeps = {},
): Promise<ImpactCardResult> {
  const sub = await getSubmission(db, submissionId);
  if (!sub || sub.user_id !== userId) throw notFound("Submission not found");
  if (sub.status !== "accepted") throw conflict("NOT_ACCEPTED", "Impact cards are for accepted observations");

  const cached = (
    await db.query<{ path: string; ai_background: boolean }>("select path, ai_background from public.impact_cards where submission_id = $1", [submissionId])
  )[0];
  if (cached && (cached.ai_background || !opts.ai) && (await storage.exists(cached.path))) {
    return { path: cached.path, ai_background: cached.ai_background, cached: true, note: null };
  }

  const bounty = await getBounty(db, sub.bounty_id);
  const protocol = bounty ? await getProtocol(db, bounty.protocol_id) : null;
  if (!protocol) throw notFound("Submission not found");
  const facts = impactFacts({
    protocol: protocol.definition,
    extracted: sub.extracted,
    fieldNotes: sub.field_notes,
    h3Cell: sub.h3_cell,
    capturedAt: sub.captured_at,
  });

  let background: Buffer | null = null;
  let note: string | null = null;
  if (opts.ai) {
    const r = await pooledBackground(db, storage, submissionId, deps);
    background = r.bytes;
    note = r.note;
  }
  const bytes = await composeCard(facts, background);
  const path = cardPath(submissionId, background !== null);
  await storage.put(path, bytes, "image/jpeg");
  await db.query(
    `insert into public.impact_cards (submission_id, user_id, path, ai_background) values ($1, $2, $3, $4)
     on conflict (submission_id) do update set path = excluded.path, ai_background = excluded.ai_background, created_at = now()`,
    [submissionId, userId, path, background !== null],
  );
  return { path, ai_background: background !== null, cached: false, note };
}

async function pooledBackground(
  db: Db,
  storage: ObjectStorage,
  submissionId: string,
  deps: ImpactDeps,
): Promise<{ bytes: Buffer | null; note: string | null }> {
  const slot = parseInt(createHash("sha256").update(submissionId).digest("hex").slice(0, 8), 16) % BG_POOL;
  const path = backgroundPath(slot);
  try {
    if (await storage.exists(path)) return { bytes: await storage.get(path), note: null };
  } catch {
    // fall through to generation
  }
  const since = new Date((deps.now ?? new Date()).getTime() - 24 * 3600_000).toISOString();
  const used = await db.query<{ n: number }>(
    "select count(*)::int as n from public.synthetic_media where kind = 'impact' and created_at > $1::timestamptz",
    [since],
  );
  if ((used[0]?.n ?? 0) >= DAILY_AI_CAP()) return { bytes: null, note: "AI backgrounds are at today's limit; here is the plain card." };
  try {
    const bytes = await (deps.generateBackground ?? (() => grokImage({ prompt: BACKGROUND_PROMPT, aspectRatio: "3:4" })))();
    await storage.put(path, bytes, "image/jpeg");
    await insertSyntheticMedia(db, { kind: "impact", path, prompt: BACKGROUND_PROMPT, model: grokEnv.imageModel });
    return { bytes, note: null };
  } catch (err) {
    console.error("[impact] background generation failed", err instanceof Error ? err.message : err);
    return { bytes: null, note: "The AI background isn't available right now; here is the plain card." };
  }
}
