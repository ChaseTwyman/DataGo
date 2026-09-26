/**
 * Presentation rules for pipeline check results and submission statuses. Icons live in the
 * components; this module decides label + tone so the rules are testable without React.
 */
import {
  STAGES,
  StageResultSchema,
  reasonKind,
  type ReasonCode,
  type StageResult,
  type StageStatus,
} from "@groundtruth/shared";

export type Tone = "success" | "warning" | "danger" | "info" | "muted" | "progress";

export const STAGE_STATUS_META: Record<StageStatus, { label: string; tone: Tone }> = {
  pending: { label: "pending", tone: "muted" },
  running: { label: "running", tone: "progress" },
  pass: { label: "pass", tone: "success" },
  warn: { label: "warn", tone: "warning" },
  fail: { label: "fail", tone: "danger" },
  // PRD §19: the demo waiver is shown on screen, never hidden.
  waived: { label: "waived (demo)", tone: "info" },
  skipped: { label: "skipped", tone: "muted" },
  error: { label: "error", tone: "danger" },
};

export type SubmissionStatus = "pending" | "verifying" | "accepted" | "rejected" | "needs_review";

export const SUBMISSION_STATUS_META: Record<SubmissionStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "muted" },
  verifying: { label: "Verifying", tone: "progress" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  needs_review: { label: "Needs review", tone: "warning" },
};

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined || !Number.isFinite(score) ? "—" : score.toFixed(2);
}

export function formatMs(ms: number): string {
  if (!(ms > 0)) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Checks in pipeline order with every stage present (missing stages shown as pending), so the table
 * has a stable shape while the pipeline is still writing results.
 */
export function orderedChecks(checks: StageResult[]): StageResult[] {
  const byStage = new Map(checks.map((c) => [c.stage, c]));
  return STAGES.map(
    (s) =>
      byStage.get(s.id) ?? {
        stage: s.id,
        label: s.label,
        status: "pending" as const,
        score: null,
        reasonCodes: [],
        evidence: [],
        ms: 0,
      },
  );
}

/** Red-team runs carry `checks: unknown[]`; keep the ones that match the shared stage shape. */
export function parseChecksLoose(raw: unknown[]): StageResult[] {
  const out: StageResult[] = [];
  for (const r of raw) {
    const p = StageResultSchema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

export function reasonTone(code: ReasonCode | string): Tone {
  let kind: string;
  try {
    kind = reasonKind(code as ReasonCode) ?? "info";
  } catch {
    kind = "info";
  }
  switch (kind) {
    case "integrity":
      return "danger";
    case "protocol":
    case "context":
      return "warning";
    case "review":
      return "progress";
    default:
      return "info";
  }
}

/** Stages that caught something: failed or errored, in pipeline order. */
export function caughtBy(checks: StageResult[]): StageResult[] {
  return orderedChecks(checks).filter((c) => c.status === "fail" || c.status === "error");
}

/** Flatten an extracted-fields object into display rows. Nested objects are JSON-stringified. */
export function extractedRows(extracted: Record<string, unknown> | null | undefined): { key: string; value: string }[] {
  if (!extracted) return [];
  return Object.entries(extracted).map(([key, v]) => ({ key, value: formatValue(v) }));
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return JSON.stringify(v);
}
