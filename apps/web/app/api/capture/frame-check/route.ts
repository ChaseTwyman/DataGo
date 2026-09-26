import {
  FRAME_CHECK_LIMIT,
  FrameCheckRequestSchema,
  GATE_REQUIRED_GREEN,
  isFrameAllGreen,
  type FrameCheckResponse,
} from "@groundtruth/shared";
import { conflict, HttpError, json, mockVariantOf, notFound, parseBody, route } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBounty } from "@/lib/db/repos/bounties";
import { getProtocol } from "@/lib/db/repos/protocols";
import { claimFrameCheck, frameCheckState, getSession, recordFrameCheck, releaseFrameCheck } from "@/lib/db/repos/sessions";
import { isLocalBackend, isMockGrok } from "@/lib/env";
import { frameCheck } from "@/lib/grok/vision";

/** Lock long enough to cover a slow Grok call; released as soon as the call ends. */
const LOCK_SECONDS = 15;

/**
 * Live checklist + coaching hint for one ~640 px frame (BUILD_PROMPT §7.1). Max 1 in flight and
 * 90 per session (claim_frame_check). A Grok failure returns 502 so the phone's gate degrades to
 * device checks (M2), never unlocks on its own.
 *
 * The server is the authority on the gate (vitamin-water incident: the phone degraded, unlocked, and
 * the server believed its gate claims). Each check updates capture_sessions.green_streak: +1 for an
 * all-green result from the real model (no screen/print suspicion), reset to 0 for anything else,
 * including errors. Mock results count only on the local backend. gate_passed_at is set when the
 * streak reaches GATE_REQUIRED_GREEN; submissions from sessions without it are capped at review.
 */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, FrameCheckRequestSchema);
  const db = await getDb();
  const session = await getSession(db, body.session_id);
  if (!session || session.user_id !== user.id) throw notFound("Session not found");
  if (session.status !== "open" || Date.parse(session.expires_at) <= Date.now()) {
    throw conflict("SESSION_CLOSED", "This capture session is no longer open");
  }
  const used = await claimFrameCheck(db, session.id, user.id, FRAME_CHECK_LIMIT, LOCK_SECONDS);
  if (used === null) {
    const st = await frameCheckState(db, session.id);
    if (st && st.frame_checks >= FRAME_CHECK_LIMIT) {
      throw new HttpError(429, "FRAME_CHECK_LIMIT", `Frame-check limit of ${FRAME_CHECK_LIMIT} reached for this session`);
    }
    throw new HttpError(429, "FRAME_CHECK_IN_FLIGHT", "A frame check is already running for this session");
  }
  const t0 = Date.now();
  try {
    const bounty = await getBounty(db, session.bounty_id);
    const protocol = bounty ? await getProtocol(db, bounty.protocol_id) : null;
    if (!protocol) throw notFound("Protocol not found");
    const variant = mockVariantOf(req);
    let result;
    try {
      result = await frameCheck({ protocol: protocol.definition, imageBase64: body.image_base64, ...(variant ? { variant } : {}) });
    } catch (err) {
      await recordFrameCheck(db, session.id, false, GATE_REQUIRED_GREEN);
      throw new HttpError(502, "GROK_UNAVAILABLE", err instanceof Error ? err.message : "Frame check failed");
    }
    const allGreen = isFrameAllGreen(protocol.definition, result);
    const countable = !isMockGrok() || isLocalBackend();
    const gate = await recordFrameCheck(db, session.id, allGreen && countable, GATE_REQUIRED_GREEN);
    const res: FrameCheckResponse = {
      result,
      all_green: allGreen,
      checks_used: used,
      checks_remaining: Math.max(0, FRAME_CHECK_LIMIT - used),
      ms: Date.now() - t0,
      green_streak: gate.green_streak,
      gate_passed: gate.gate_passed,
    };
    return json(res);
  } finally {
    await releaseFrameCheck(db, session.id);
  }
});
