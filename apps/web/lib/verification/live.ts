/**
 * Live submission processing (runs in `after()`): load → run pipeline writing each stage into
 * submissions.checks → decide → payout ledger → trust → bounty budget. Idempotent per submission:
 * only a `pending` submission is processed.
 */
import {
  pendingChecks,
  payoutCents,
  trustEventFor,
  updateTrust,
  type MockVariant,
  type DecisionStatus,
  type ReasonCode,
  type SubmissionStatus,
} from "@groundtruth/shared";
import type { Db } from "../db";
import { getBounty, spendBudget } from "../db/repos/bounties";
import { insertLedger } from "../db/repos/ledger";
import { getProfile, setTrust } from "../db/repos/profiles";
import { getProtocol } from "../db/repos/protocols";
import { getSession, setSessionStatus } from "../db/repos/sessions";
import { finalizeSubmission, getSubmission, setChecks } from "../db/repos/submissions";
import type { ObjectStorage } from "../storage";
import { runPipeline } from "./pipeline";
import { isObservationPath } from "./syntheticGuard";
import type { PipelineDeps, PipelineFrame } from "./types";

export interface ProcessOptions {
  deps: PipelineDeps;
  storage: ObjectStorage;
  mockVariant?: MockVariant;
}

export async function processSubmission(db: Db, submissionId: string, opts: ProcessOptions): Promise<SubmissionStatus | null> {
  const sub = await getSubmission(db, submissionId);
  if (!sub || sub.status !== "pending") return null;
  try {
    return await process(db, submissionId, opts);
  } catch (err) {
    // Anything unexpected outside a stage: never auto-accept, never leave it spinning.
    console.error("[pipeline] submission failed", submissionId, err);
    const cur = await getSubmission(db, submissionId);
    await finalizeSubmission(db, submissionId, {
      status: "needs_review",
      checks: cur?.checks ?? pendingChecks(),
      reason_codes: ["STAGE_ERROR"],
      confidence: 0,
      protocol_score: null,
      authenticity_score: null,
      extracted: null,
      phashes: [],
      payout_cents: 0,
      retryable: false,
      verifier: opts.deps.verifier,
    });
    return "needs_review";
  }
}

async function process(db: Db, submissionId: string, opts: ProcessOptions): Promise<SubmissionStatus> {
  const sub = (await getSubmission(db, submissionId))!;
  const [bounty, profile, session] = await Promise.all([
    getBounty(db, sub.bounty_id),
    getProfile(db, sub.user_id),
    sub.session_id ? getSession(db, sub.session_id) : Promise.resolve(null),
  ]);
  if (!bounty) throw new Error("bounty missing");
  const protocolRow = await getProtocol(db, bounty.protocol_id);
  if (!protocolRow) throw new Error("protocol missing");
  const protocol = protocolRow.definition;

  await setChecks(db, submissionId, pendingChecks(), "verifying");

  // Load frames. Synthetic paths are never even read in the live pipeline (session integrity rejects).
  const frames: PipelineFrame[] = await Promise.all(
    sub.media.map(async (m) => {
      if (!isObservationPath(m.path)) return { path: m.path, bytes: null };
      try {
        return { path: m.path, bytes: await opts.storage.get(m.path) };
      } catch {
        return { path: m.path, bytes: null };
      }
    }),
  );

  const trust = profile?.trust_score ?? 0.5;
  const result = await runPipeline(
    {
      source: "live",
      submissionId,
      userId: sub.user_id,
      frames,
      lat: sub.lat,
      lng: sub.lng,
      accuracy_m: sub.accuracy_m,
      captured_at: sub.captured_at,
      received_at: sub.received_at,
      // The route stores the submitted nonce in the server-only `gate` jsonb (no dedicated column).
      nonce: typeof (sub.gate as Record<string, unknown>).nonce === "string" ? ((sub.gate as Record<string, unknown>).nonce as string) : null,
      device: sub.device,
      sensors: sub.sensors,
      gate: sub.gate,
      field_notes: sub.field_notes ?? {},
      h3_cell: sub.h3_cell,
      bounty: { id: bounty.id, cells: bounty.cells, area: bounty.area, starts_at: bounty.starts_at, ends_at: bounty.ends_at },
      protocol,
      session,
      challenge: session?.challenge ?? protocol.capture.challenges[0]!,
      trustScore: trust,
      ...(opts.mockVariant ? { mockVariant: opts.mockVariant } : {}),
    },
    opts.deps,
    { write: (checks) => setChecks(db, submissionId, checks) },
  );

  const d = result.decision;
  let status: DecisionStatus = d.status;
  const codes: ReasonCode[] = [...d.reasonCodes];
  let payout = status === "accepted" && session ? payoutCents(session.price_quote_cents, d.payoutMultiplier) : 0;

  await db.tx(async (tx) => {
    if (status === "accepted" && payout > 0) {
      const funded = await spendBudget(tx, bounty.id, payout);
      if (!funded) {
        status = "needs_review";
        codes.push("BUDGET_EXHAUSTED");
        payout = 0;
      }
    }
    await finalizeSubmission(tx, submissionId, {
      status,
      checks: result.checks,
      reason_codes: [...new Set(codes)],
      confidence: d.confidence,
      protocol_score: result.model?.protocol_score ?? null,
      authenticity_score: result.model?.authenticity_score ?? null,
      extracted: result.model?.extraction ?? null,
      phashes: result.phashes,
      payout_cents: payout,
      retryable: status === "rejected" && d.retryable,
      verifier: opts.deps.verifier,
    });
    if (status === "accepted" && payout > 0) {
      await insertLedger(tx, { user_id: sub.user_id, submission_id: submissionId, amount_cents: payout, kind: "payout" });
    }
    const next = updateTrust(trust, trustEventFor(status, status === "rejected" ? d.rejectionKind : null));
    if (next !== trust) await setTrust(tx, sub.user_id, next);
    // A protocol-quality rejection may be retried while the session window lasts (PRD §7.5).
    if (session && status === "rejected" && d.retryable) await setSessionStatus(tx, session.id, "open");
  });
  return status;
}
