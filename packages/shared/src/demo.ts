/** Fixed ids and values for the seeded demo state (also used by demo:reset and tests). */
export const DEMO = {
  researcherId: "00000000-0000-4000-8000-000000000001",
  researcherEmail: "researcher@groundtruth.dev",
  researcherPassword: "groundtruth-demo",
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
} as const;
