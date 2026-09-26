/**
 * Synthetic media must never reach submissions or exports (PRD §13, BUILD_PROMPT §9).
 * The live pipeline and POST /api/submissions accept only paths in the private `observations`
 * bucket. Belt and braces with the DB trigger `guard_submission_media`.
 * Red-team runs are the one exception: they deliberately feed synthetic media through the pipeline,
 * and they write to redteam_runs, never submissions.
 */
export const OBSERVATIONS_PREFIX = "observations/";

export class SyntheticMediaError extends Error {
  readonly code = "SYNTHETIC_MEDIA";
  constructor(readonly paths: string[]) {
    super(`Only observations/ media may enter the live pipeline; refused: ${paths.join(", ")}`);
  }
}

export function isObservationPath(path: string): boolean {
  return path.startsWith(OBSERVATIONS_PREFIX) && !path.split("/").includes("..");
}

export function nonObservationPaths(paths: string[]): string[] {
  return paths.filter((p) => !isObservationPath(p));
}

export function assertObservationPaths(paths: string[]): void {
  const bad = nonObservationPaths(paths);
  if (bad.length > 0) throw new SyntheticMediaError(bad);
}
