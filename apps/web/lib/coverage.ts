/**
 * Live per-cell prices for a request. The pricing itself is the platform's engine
 * (lib/pricing/engine.ts, config in lib/pricing/config.ts); this module keeps the old entry points.
 */
import type { BountyRow } from "./db/repos/bounties";

export { loadCoverage, loadPricing } from "./pricing/market";

/** Allocation not yet paid out (ignores locked quotes; use loadPricing().remainingCents for that). */
export const budgetRemaining = (b: Pick<BountyRow, "budget_cents" | "spent_cents">) => Math.max(0, b.budget_cents - b.spent_cents);
