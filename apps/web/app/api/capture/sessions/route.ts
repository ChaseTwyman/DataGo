import { randomBytes, randomUUID } from "node:crypto";
import {
  cellForPoint,
  CreateSessionRequestSchema,
  FRAME_CHECK_LIMIT,
  insideBountyArea,
  lockQuote,
  pickChallenge,
  type CreateSessionResponse,
} from "@groundtruth/shared";
import { loadVisibleBounty } from "@/lib/api/bountyAccess";
import { conflict, HttpError, json, originOf, parseBody, route } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { budgetRemaining, loadCoverage } from "@/lib/coverage";
import { getDb } from "@/lib/db";
import { insertSession } from "@/lib/db/repos/sessions";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";
import { getStorage } from "@/lib/storage";

const SESSION_TTL_MIN = 15;

/**
 * Opens a capture session: nonce, random challenge from the protocol pool, price quote locked for
 * 15 minutes, and one signed upload URL per burst frame. Refused when the bounty is not live, the
 * caller is outside the area, the cell is hazard-paused, or the budget cannot cover the quote.
 */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, CreateSessionRequestSchema);
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.captureSession, user.id);
  const { bounty, protocol } = await loadVisibleBounty(db, user, body.bounty_id);
  const now = new Date();
  if (bounty.status !== "active" || Date.parse(bounty.starts_at) > now.getTime() || Date.parse(bounty.ends_at) <= now.getTime()) {
    throw conflict("BOUNTY_NOT_ACTIVE", "This bounty is not accepting captures right now");
  }
  if (!insideBountyArea(body.lat, body.lng, bounty.cells, bounty.area)) {
    throw new HttpError(422, "OUTSIDE_AREA", "You are outside the bounty area");
  }
  const cell = cellForPoint(body.lat, body.lng);
  const coverage = await loadCoverage(db, bounty, protocol.definition, now);
  const here = coverage.find((c) => c.cell === cell) ?? [...coverage].sort((a, b) => b.price_cents - a.price_cents)[0];
  if (!here) throw conflict("BOUNTY_NOT_ACTIVE", "Bounty has no cells");
  if (here.paused) throw conflict("HAZARD_PAUSED", here.paused_reason ?? "Captures are paused here because of an active hazard warning");
  if (budgetRemaining(bounty) < here.price_cents) throw conflict("BUDGET_EXHAUSTED", "This bounty has run out of budget");

  const id = randomUUID();
  const quote = lockQuote(here.price_cents, now);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MIN * 60_000).toISOString();
  const challenge = pickChallenge(protocol.definition);
  const nonce = randomBytes(16).toString("hex");
  const paths = Array.from({ length: protocol.definition.capture.frames }, (_, i) => `observations/${user.id}/${id}/${i}.jpg`);

  await insertSession(db, {
    id,
    bounty_id: bounty.id,
    user_id: user.id,
    nonce,
    challenge,
    cell,
    start_lat: body.lat,
    start_lng: body.lng,
    price_quote_cents: quote.priceCents,
    quote_expires_at: quote.expiresAt,
    started_at: now.toISOString(),
    expires_at: expiresAt,
    upload_paths: paths,
  });
  const storage = getStorage();
  const origin = originOf(req);
  const uploads = await Promise.all(
    paths.map(async (path) => {
      const t = await storage.signedUpload(path, origin);
      return { path, signed_url: t.signed_url, token: t.token };
    }),
  );
  const res: CreateSessionResponse = {
    session_id: id,
    nonce,
    challenge,
    price_quote_cents: quote.priceCents,
    quote_expires_at: quote.expiresAt,
    expires_at: expiresAt,
    cell,
    uploads,
    protocol: protocol.definition,
    frame_check_limit: FRAME_CHECK_LIMIT,
  };
  return json(res, { status: 201 });
});
