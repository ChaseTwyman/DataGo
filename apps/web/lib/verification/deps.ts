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
import { isDemoMode, isOffline } from "../env";
import { verifyCapture } from "../grok/vision";
import type { PipelineDeps } from "./types";

export function liveDeps(db: Db, overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    now: () => new Date(),
    demoMode: isDemoMode(),
    offline: isOffline(),
    verify: (a) => verifyCapture(a),
    precipitationMm: pastPrecipitationMm,
    alertsAt: activeAlertsAt,
    priorHashes: (ex) => priorHashes(db, ex),
    countUserCellSince: (u, c, s, ex) => countUserCellSince(db, u, c, s, ex),
    previousUserSubmission: (u, b, ex) => previousUserSubmission(db, u, b, ex),
    acceptedNear: (b, at, w, ex) => acceptedNear(db, b, at, w, ex),
    ...overrides,
  };
}

/** Deps with no database: eval runs judge fixtures in isolation (no priors, no neighbours). */
export function isolatedDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    now: () => new Date(),
    demoMode: isDemoMode(),
    offline: isOffline(),
    verify: (a) => verifyCapture(a),
    precipitationMm: pastPrecipitationMm,
    alertsAt: activeAlertsAt,
    priorHashes: async () => [],
    countUserCellSince: async () => 0,
    previousUserSubmission: async () => null,
    acceptedNear: async () => [],
    ...overrides,
  };
}
