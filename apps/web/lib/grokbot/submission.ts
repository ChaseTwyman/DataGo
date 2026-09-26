/**
 * Phase 1 (verification companion) and Phase 5 (reviewer brief) for one submission.
 * Access: the submission's owner gets the contributor view; a researcher who manages the bounty (or
 * an admin) gets the researcher view. Anyone else: 404 (never 403, so ids can't be probed).
 */
import type { GrokbotMessage, NarrationResponse } from "@groundtruth/shared";
import { notFound } from "../api/http";
import { canManageBounty, type AuthUser } from "../auth";
import type { Db } from "../db";
import { getBounty, type BountyRow } from "../db/repos/bounties";
import { getProfile } from "../db/repos/profiles";
import { getProtocol, type ProtocolRow } from "../db/repos/protocols";
import { getSubmission, type SubmissionRecord } from "../db/repos/submissions";
import { TERMINAL, contributorSubmissionCase, isNeutralForContributor, researcherSubmissionCase } from "./caseFile";
import { composeMessage, type Generate } from "./compose";
import { contributorExplainTemplate, narrationText, researcherExplainTemplate } from "./templates";
import type { CaseFile } from "./types";

export type SubmissionView = "contributor" | "researcher" | "admin";

export interface LoadedSubmission {
  submission: SubmissionRecord;
  bounty: BountyRow;
  protocol: ProtocolRow;
  view: SubmissionView;
}

/** Bounty managers see the researcher view (even of their own test captures); owners the contributor view. */
export async function loadSubmissionFor(db: Db, user: AuthUser, id: string, opts: { managerOnly?: boolean } = {}): Promise<LoadedSubmission> {
  const submission = await getSubmission(db, id);
  if (!submission) throw notFound("Submission not found");
  const bounty = await getBounty(db, submission.bounty_id);
  if (!bounty) throw notFound("Submission not found");
  let view: SubmissionView | null = null;
  if (canManageBounty(user, bounty.created_by)) view = user.isAdmin && bounty.created_by !== user.id ? "admin" : "researcher";
  else if (!opts.managerOnly && submission.user_id === user.id) view = "contributor";
  if (!view) throw notFound("Submission not found");
  const protocol = await getProtocol(db, bounty.protocol_id);
  if (!protocol) throw notFound("Protocol not found");
  return { submission, bounty, protocol, view };
}

export async function submissionCase(db: Db, l: LoadedSubmission, kind = "explain"): Promise<CaseFile> {
  const input = { submission: l.submission, protocol: l.protocol.definition, bountyTitle: l.bounty.title };
  if (l.view === "contributor") return contributorSubmissionCase(input, kind);
  const trust = (await getProfile(db, l.submission.user_id))?.trust_score ?? null;
  return researcherSubmissionCase({ ...input, contributorTrust: trust }, l.view, kind);
}

const EXPLAIN_TASK: Record<SubmissionView, string> = {
  contributor:
    "Explain the outcome of this capture to the contributor who took it. If it was not accepted because of the protocol, give concrete fixes using the required elements and framing tips. Never speculate about why a capture could not be verified.",
  researcher: "Summarize for the researcher why this capture has its status: which stages mattered and what, if anything, a reviewer should look at. Do not recommend a decision.",
  admin: "Summarize for an administrator why this capture has its status: which stages mattered and what a reviewer should look at. Do not recommend a decision.",
};

export async function explainSubmission(db: Db, l: LoadedSubmission, o: { mockError?: boolean; generate?: Generate } = {}): Promise<GrokbotMessage> {
  const c = await submissionCase(db, l, "explain");
  const contributor = l.view === "contributor";
  return composeMessage(db, {
    op: "explain",
    caseFile: c,
    task: EXPLAIN_TASK[l.view],
    template: contributor ? contributorExplainTemplate(c) : researcherExplainTemplate(c),
    // Integrity rejects: the neutral sentence is the whole answer; nothing for a model to add. Rows
    // still verifying change every few seconds: not worth a model call either.
    templateOnly: (contributor && isNeutralForContributor(l.submission)) || !TERMINAL.has(l.submission.status),
    ...(o.mockError ? { mockError: true } : {}),
    ...(o.generate ? { generate: o.generate } : {}),
  });
}

/**
 * Narration lines for every finished stage. Stages finish strictly in pipeline order, so the
 * finished set is a prefix; seq is 1-based and contiguous, so `after` can be either the last seq the
 * client has or the number of lines it has (the same number). `at` = received_at + cumulative stage ms.
 */
export function narrationLines(l: LoadedSubmission, after: number): NarrationResponse["lines"] {
  const s = l.submission;
  const lines: NarrationResponse["lines"] = [];
  let t = Date.parse(s.received_at);
  const neutral = l.view === "contributor" && isNeutralForContributor(s);
  for (const [i, c] of s.checks.entries()) {
    if (c.status === "pending" || c.status === "running") break;
    t += c.ms;
    const seq = i + 1;
    if (seq <= after) continue;
    // The contributor view of an integrity reject never carries any stage's real result.
    const status = neutral ? "skipped" : c.status;
    lines.push({ seq, stage: c.stage, text: narrationText(c.stage, status, l.view, c.reasonCodes, c.label), at: new Date(t).toISOString() });
  }
  return lines;
}

export async function narrate(db: Db, l: LoadedSubmission, after: number, o: { mockError?: boolean } = {}): Promise<NarrationResponse> {
  const done = TERMINAL.has(l.submission.status);
  return {
    lines: narrationLines(l, after),
    done,
    final: done ? await explainSubmission(db, l, o) : null,
  };
}
