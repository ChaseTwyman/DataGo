/**
 * Post-decision face / licence-plate redaction (PRD §13). For each frame of a decided submission:
 * detect faces and plates (fast vision), blur them with a safety margin (lib/image/redact.ts), store
 * the derivative next to the original (`<n>.redacted.jpg`, private observations bucket) and record
 * `media[i].redacted_path` + a `redaction` summary on the row.
 *
 * Runs strictly AFTER verification decided (the pipeline, dHash, C2PA and the model only ever read
 * originals) and never changes the decision: status, scores, payout and verifier are not touched.
 * Idempotent: a submission whose redaction is `done` is skipped; a failure is recorded with an
 * attempt count and retried by the daily cron / the backfill script. Researchers see no photo until
 * redaction succeeds (fail closed).
 */
import type { MediaItemRow, RedactionSummary } from "@groundtruth/shared";
import type { Db } from "../db";
import { claimRedaction, getSubmission, redactionBacklog, setRedaction, setRedactionSummary } from "../db/repos/submissions";
import { grokEnv, isMockGrok } from "../grok/config";
import { detectPrivacyRegions, type PrivacyDetection } from "../grok/vision";
import { toModelFrame } from "../image/modelFrame";
import { redactedPathFor, redactImage } from "../image/redact";
import type { ObjectStorage } from "../storage";

/** Frames are sent to the detector at this size: small faces need resolution; not latency-critical. */
export const DETECTION_FRAME_MAX_EDGE = 1280;

export interface RedactionDeps {
  storage: ObjectStorage;
  detect(imageBase64: string): Promise<PrivacyDetection>;
  now(): Date;
}

export function liveRedactionDeps(storage: ObjectStorage): RedactionDeps {
  return { storage, detect: (b) => detectPrivacyRegions({ imageBase64: b }), now: () => new Date() };
}

const DECIDED = new Set(["accepted", "rejected", "needs_review"]);

/** Only the submitter's own folder: a rejected row can carry foreign paths; never read or write through them. */
export function ownObservationPath(path: string, userId: string): boolean {
  return path.startsWith(`observations/${userId}/`) && !path.includes("..") && !path.includes("\\");
}

export type RedactionOutcome = "done" | "failed" | "skipped";

interface FrameResult {
  media: MediaItemRow;
  frame: NonNullable<RedactionSummary["frames"]>[number];
}

export async function redactSubmission(db: Db, submissionId: string, deps: RedactionDeps): Promise<RedactionOutcome> {
  const sub = await getSubmission(db, submissionId);
  if (!sub || !DECIDED.has(sub.status) || sub.media_purged_at || sub.media.length === 0) return "skipped";
  if (sub.redaction?.status === "done") return "skipped";
  const attempts = (sub.redaction?.attempts ?? 0) + 1;
  if (!(await claimRedaction(db, submissionId, deps.now().toISOString()))) return "skipped";
  const written: string[] = [];
  try {
    // Frames in parallel (one detection call each); order preserved. allSettled: on a failure every
    // frame has finished writing before the cleanup below removes what was written.
    const settled = await Promise.allSettled(
      sub.media.map(async (m): Promise<FrameResult> => {
        if (!ownObservationPath(m.path, sub.user_id)) {
          // Not this contributor's capture (integrity already rejected the row): no derivative, so
          // researchers get no image for it. Never read another user's photo through it.
          const { redacted_path: _drop, ...rest } = m;
          void _drop;
          return { media: rest, frame: { faces: 0, plates: 0 } };
        }
        const original = await deps.storage.get(m.path);
        const frame = await toModelFrame(original, DETECTION_FRAME_MAX_EDGE);
        const found = await deps.detect(frame.toString("base64"));
        const boxes = found.regions;
        // The detector says something is there but gave no usable box: blur everything.
        const wholeFrame = found.faces_or_plates_present && boxes.length === 0;
        const out = await redactImage(original, boxes, { wholeFrame });
        const path = redactedPathFor(m.path);
        written.push(path);
        await deps.storage.put(path, out.bytes, "image/jpeg");
        return {
          media: { ...m, redacted_path: path },
          frame: {
            faces: boxes.filter((b) => b.kind === "face").length,
            plates: boxes.filter((b) => b.kind === "license_plate").length,
            ...(wholeFrame ? { whole_frame: true } : {}),
          },
        };
      }),
    );
    const results: FrameResult[] = [];
    for (const r of settled) {
      if (r.status === "rejected") throw r.reason;
      results.push(r.value);
    }
    const media = results.map((r) => r.media);
    const frames = results.map((r) => r.frame);
    const summary: RedactionSummary = {
      status: "done",
      at: deps.now().toISOString(),
      model: isMockGrok() ? "mock" : grokEnv.fastVisionModel,
      frames,
      attempts,
    };
    if (!(await setRedaction(db, submissionId, media, summary))) {
      // Photos were purged while we worked (retention / account deletion): don't leave derivatives.
      await deps.storage.remove(written);
      return "skipped";
    }
    return "done";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[redaction] failed", submissionId, msg);
    if (written.length > 0) await deps.storage.remove(written).catch(() => undefined);
    await setRedactionSummary(db, submissionId, { status: "failed", at: deps.now().toISOString(), error: msg.slice(0, 300), attempts }).catch(
      (e: unknown) => console.warn("[redaction] could not record failure", submissionId, e),
    );
    return "failed";
  }
}

/** Never throws: redaction must not affect the request or the verification outcome. */
export async function redactSubmissionSafely(db: Db, submissionId: string, deps: RedactionDeps): Promise<RedactionOutcome> {
  try {
    return await redactSubmission(db, submissionId, deps);
  } catch (err) {
    console.warn("[redaction] unexpected", submissionId, err instanceof Error ? err.message : err);
    return "failed";
  }
}

/** Retries / backfill: redacts up to `limit` submissions that need it. Used by the cron and the backfill script. */
export async function redactBacklog(db: Db, deps: RedactionDeps, limit = 20): Promise<Record<RedactionOutcome, number>> {
  const out: Record<RedactionOutcome, number> = { done: 0, failed: 0, skipped: 0 };
  for (const id of await redactionBacklog(db, limit)) out[await redactSubmissionSafely(db, id, deps)]++;
  return out;
}
