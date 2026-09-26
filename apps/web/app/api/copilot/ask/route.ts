import { route } from "@/lib/api/http";
import { requireResearcher } from "@/lib/auth";
import { handleAsk } from "@/lib/copilot/http";
import { getDb } from "@/lib/db";

export const maxDuration = 60;

/**
 * Ask the data (signed-in researchers). Body: CopilotAskRequest; optional bounty_id scopes to one
 * of the caller's own requests (still the coarsened public rows) and unlocks coverage-vs-target.
 * The model only fills a validated query plan; SQL is parameterized; see lib/copilot.
 */
export const POST = route(async (req) => {
  const user = await requireResearcher(req);
  return handleAsk(req, await getDb(), user);
});
