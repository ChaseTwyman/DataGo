import { z } from "zod";
import { ReasonCodeSchema } from "./reasonCodes";

/**
 * Pipeline layers, PRD §9.2, in run order. `relevance` (added after the vitamin-water incident) is a
 * cheap fast-vision "is this even the right subject?" check that runs before the slow reasoning
 * model, independent of it.
 */
export const STAGES = [
  { id: "session_integrity", label: "Session integrity" },
  { id: "relevance", label: "Subject relevance" },
  { id: "challenge", label: "Challenge-response" },
  { id: "protocol", label: "Protocol compliance" },
  { id: "authenticity", label: "Authenticity" },
  { id: "context", label: "Context plausibility" },
  { id: "duplicates", label: "Duplicates & velocity" },
  { id: "corroboration", label: "Corroboration & reputation" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
export const StageIdSchema = z.enum(STAGES.map((s) => s.id) as [StageId, ...StageId[]]);

export const StageStatusSchema = z.enum([
  "pending",
  "running",
  "pass",
  "warn",
  "fail",
  "waived",
  "skipped",
  "error",
]);
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const SubcheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: StageStatusSchema,
  detail: z.string().optional(),
});
export type Subcheck = z.infer<typeof SubcheckSchema>;

export const StageResultSchema = z.object({
  stage: StageIdSchema,
  label: z.string(),
  status: StageStatusSchema,
  /** 0..1, null when the stage does not score. */
  score: z.number().min(0).max(1).nullable(),
  reasonCodes: z.array(ReasonCodeSchema),
  evidence: z.array(z.string()),
  subchecks: z.array(SubcheckSchema).optional(),
  ms: z.number().int().min(0),
});
export type StageResult = z.infer<typeof StageResultSchema>;

export const ChecksSchema = z.array(StageResultSchema);

export function pendingChecks(): StageResult[] {
  return STAGES.map((s) => ({
    stage: s.id,
    label: s.label,
    status: "pending",
    score: null,
    reasonCodes: [],
    evidence: [],
    ms: 0,
  }));
}

export function stageLabel(id: StageId): string {
  return STAGES.find((s) => s.id === id)?.label ?? id;
}
