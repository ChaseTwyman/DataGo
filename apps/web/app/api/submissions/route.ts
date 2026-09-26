import {
  cellForPoint,
  CreateSubmissionRequestSchema,
  pendingChecks,
  SubmissionListQuerySchema,
  type CreateSubmissionResponse,
} from "@groundtruth/shared";
import { runInBackground } from "@/lib/background";
import { conflict, HttpError, json, mockVariantOf, notFound, originOf, parseBody, parseQuery, route } from "@/lib/api/http";
import { submissionWithMedia } from "@/lib/api/views";
import { requireResearcher, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBounty, listBountiesFor } from "@/lib/db/repos/bounties";
import { getSession, markSubmittedIfOpen } from "@/lib/db/repos/sessions";
import { insertSubmission, listSubmissions } from "@/lib/db/repos/submissions";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";
import { getStorage } from "@/lib/storage";
import { liveDeps } from "@/lib/verification/deps";
import { processSubmission } from "@/lib/verification/live";
import { nonObservationPaths } from "@/lib/verification/syntheticGuard";

/**
 * Creates a submission for an open capture session and starts the verification pipeline in
 * `after()`. Responds immediately with status `pending`; clients watch the row (realtime) or poll
 * GET /api/submissions/:id.
 */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, CreateSubmissionRequestSchema);
  const synthetic = nonObservationPaths(body.media.map((m) => m.path));
  if (synthetic.length > 0) {
    throw new HttpError(400, "SYNTHETIC_MEDIA", "Submissions may only reference camera captures in the observations bucket", synthetic);
  }
  const db = await getDb();
  await enforceRateLimit(db, LIMITS.submission, user.id);
  const session = await getSession(db, body.session_id);
  if (!session || session.user_id !== user.id) throw notFound("Session not found");
  if (session.status !== "open") throw conflict("SESSION_ALREADY_SUBMITTED", "This session has already been submitted");
  const bounty = await getBounty(db, session.bounty_id);
  if (!bounty) throw notFound("Bounty not found");

  const id = await db.tx(async (tx) => {
    if (!(await markSubmittedIfOpen(tx, session.id))) {
      throw conflict("SESSION_ALREADY_SUBMITTED", "This session has already been submitted");
    }
    return insertSubmission(tx, {
      session_id: session.id,
      bounty_id: bounty.id,
      user_id: user.id,
      media: body.media,
      lat: body.lat,
      lng: body.lng,
      accuracy_m: body.accuracy_m,
      h3_cell: cellForPoint(body.lat, body.lng),
      captured_at: body.captured_at,
      device: body.device,
      sensors: body.sensors,
      gate: { ...body.gate, nonce: body.nonce },
      field_notes: body.field_notes,
      checks: pendingChecks(),
    });
  });

  const variant = mockVariantOf(req);
  runInBackground(async () => {
    await processSubmission(await getDb(), id, {
      deps: liveDeps(await getDb()),
      storage: getStorage(),
      ...(variant ? { mockVariant: variant } : {}),
    });
  });
  const res: CreateSubmissionResponse = { submission_id: id, status: "pending" };
  return json(res, { status: 202 });
});

/** Researcher list: own bounties' submissions (admin: all), newest first. */
export const GET = route(async (req) => {
  const user = await requireResearcher(req);
  const q = parseQuery(req, SubmissionListQuerySchema);
  const db = await getDb();
  const own = await listBountiesFor(db, user.id, user.isAdmin);
  const titles = new Map(own.map((b) => [b.id, b.title]));
  if (q.bounty_id && !titles.has(q.bounty_id)) throw notFound("Bounty not found");
  const rows = await listSubmissions(db, {
    bountyIds: user.isAdmin ? null : [...titles.keys()],
    ...(q.bounty_id ? { bountyId: q.bounty_id } : {}),
    ...(q.status ? { status: q.status } : {}),
    limit: q.limit,
  });
  const origin = originOf(req);
  const submissions = await Promise.all(rows.map((s) => submissionWithMedia(s, origin, titles.get(s.bounty_id) ?? null)));
  return json({ submissions });
});
