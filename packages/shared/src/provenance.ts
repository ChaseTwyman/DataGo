/**
 * Who (or what) decided a submission, and what may be published because of it.
 *
 * After the vitamin-water incident the public dataset held 40 seed-script rows and one row accepted
 * by MOCK_GROK (which approves anything) against the real database. `submissions.verifier` records
 * provenance so that can't recur silently:
 *   model — the real verification pipeline decided
 *   mock  — decided while MOCK_GROK was on (fixtures; approves anything). Never exported/published.
 *   human — a reviewer decided from the review queue
 *   none  — demo/seed tooling wrote the row; nothing verified it. Never exported/published.
 */
import { z } from "zod";

export const VerifierSchema = z.enum(["model", "mock", "human", "none"]);
export type Verifier = z.infer<typeof VerifierSchema>;

/** Verifiers whose rows never leave the system (researcher exports, public datasets). */
export const UNPUBLISHABLE_VERIFIERS: readonly Verifier[] = ["mock", "none"];

/** Minimum blended confidence for a model-verified row to be published. */
export const PUBLISH_MIN_CONFIDENCE = 0.75;

export const QualityTierSchema = z.enum(["human_verified", "model_high"]);
export type QualityTier = z.infer<typeof QualityTierSchema>;

/**
 * Public-dataset tier of an accepted row, or null when it must not be published.
 * Mirrors the `quality_tier` expression in the observations_export view (migration 000005).
 */
export function qualityTier(status: string, verifier: string | null | undefined, confidence: number | null | undefined): QualityTier | null {
  if (status !== "accepted") return null;
  if (verifier === "human") return "human_verified";
  if (verifier === "model" && typeof confidence === "number" && confidence >= PUBLISH_MIN_CONFIDENCE) return "model_high";
  return null;
}

/** Verifier a human review leaves behind: mock/none rows stay unpublishable even if approved. */
export function verifierAfterReview(current: Verifier): Verifier {
  return (UNPUBLISHABLE_VERIFIERS as readonly string[]).includes(current) ? current : "human";
}
