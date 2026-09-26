/** Production PipelineDeps: repos for lookups, Grok for vision, Open-Meteo/NWS for context. */
import { activeAlertsAt } from "../context/nws";
import { pastPrecipitationMm } from "../context/openMeteo";
import type { Db } from "../db";
import {
  acceptedNear,
  countUserCellSince,
  previousUserSubmission,
  priorHashes,
} from "../db/repos/submissions";
import { isDemoMode, isMockGrok, isOffline } from "../env";
import { relevanceCheck, verifyCapture } from "../grok/vision";
import type { PipelineDeps } from "./types";

const g = globalThis as typeof globalThis & { __gtDepsOverride?: Partial<PipelineDeps> | null };

/**
 * Tests only: overrides merged into every liveDeps() (routes build their own deps, so an
 * end-to-end test can, e.g., make the reasoning model time out behind POST /api/submissions).
 */
export function setPipelineDepsOverrideForTests(o: Partial<PipelineDeps> | null): void {
  g.__gtDepsOverride = o;
}

function grokDeps(): Pick<PipelineDeps, "verify" | "relevance" | "verifier"> {
  return {
    verify: (a) => verifyCapture(a),
    relevance: (a) => relevanceCheck({ protocol: a.protocol, imageBase64: a.frameBase64, ...(a.variant ? { variant: a.variant } : {}) }),
    // Read at construction: whatever decides this run is what gets recorded on the row.
    verifier: isMockGrok() ? "mock" : "model",
  };
}

export function liveDeps(db: Db, overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    now: () => new Date(),
    demoMode: isDemoMode(),
    offline: isOffline(),
    ...grokDeps(),
    precipitationMm: pastPrecipitationMm,
    alertsAt: activeAlertsAt,
    priorHashes: (ex) => priorHashes(db, ex),
    countUserCellSince: (u, c, s, ex) => countUserCellSince(db, u, c, s, ex),
    previousUserSubmission: (u, b, ex) => previousUserSubmission(db, u, b, ex),
    acceptedNear: (b, at, w, ex) => acceptedNear(db, b, at, w, ex),
    ...(g.__gtDepsOverride ?? {}),
    ...overrides,
  };
}

/** Deps with no database: eval runs judge fixtures in isolation (no priors, no neighbours). */
export function isolatedDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    now: () => new Date(),
    demoMode: isDemoMode(),
    offline: isOffline(),
    ...grokDeps(),
    precipitationMm: pastPrecipitationMm,
    alertsAt: activeAlertsAt,
    priorHashes: async () => [],
    countUserCellSince: async () => 0,
    previousUserSubmission: async () => null,
    acceptedNear: async () => [],
    ...overrides,
  };
}
