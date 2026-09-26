/** Fixed ids and values for the seeded demo state (also used by demo:reset and tests). */
export const DEMO = {
  researcherId: "00000000-0000-4000-8000-000000000001",
  researcherEmail: "researcher@groundtruth.dev",
  // No password here: the seed generator sets a random one (SEED_ADMIN_PASSWORD or printed once);
  // rotate the hosted one with apps/web/scripts/rotate-admin-password.ts.
  protocolId: "00000000-0000-4000-8000-000000000101",
  bountyId: "00000000-0000-4000-8000-000000000201",
  title: "Midtown flash flood: street depth",
  summary:
    "Heavy rain is flooding low streets. Street-level depth readings calibrate the city's flood model.",
  // Georgia Tech campus, Atlanta. Use POST /api/demo/spawn-event to move the demo to your venue.
  lat: 33.7756,
  lng: -84.3963,
  radiusM: 800,
  baseCents: 200,
  maxCents: 1000,
  targetPerCell: 5,
  budgetCents: 50_000,
  /** Demo sponsor: sponsors pay to direct collection; the data stays free for everyone. */
  sponsorName: "Georgia Tech Urban Hydrology Lab (demo)",
  sponsorUrl: null as string | null,
  /** De-identified owner of open-data rows whose contributor deleted their account (migration 000006). */
  deletedUserId: "00000000-0000-4000-8000-00000000dead",
} as const;
