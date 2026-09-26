/** Route plumbing for Ask the data: rate limits and the shared handler body. */
import { CopilotAskRequestSchema } from "@groundtruth/shared";
import { forbidden, json, mockVariantOf, originOf, parseBody } from "../api/http";
import type { AuthUser } from "../auth";
import type { Db } from "../db";
import { assertGrokbotEnabled } from "../grokbot/http";
import { clientIp, enforceRateLimit, type Limit } from "../rateLimit";
import { askData } from "./ask";

const HOUR = 3600;
/**
 * Each ask can cost two model calls (plan + answer; both cached). Public is per IP (stricter) plus a
 * global public ceiling so a botnet can't run up the bill; researchers are per account.
 */
export const COPILOT_LIMITS = {
  researcher: { name: "copilot", max: 120, windowSeconds: HOUR, what: "questions" },
  publicIp: { name: "copilot_public_ip", max: 20, windowSeconds: HOUR, what: "questions from this network" },
  publicGlobal: { name: "copilot_public_all", max: 400, windowSeconds: HOUR, what: "public questions (site-wide)" },
} as const satisfies Record<string, Limit>;

export async function handleAsk(req: Request, db: Db, user: AuthUser | null): Promise<Response> {
  assertGrokbotEnabled();
  const body = await parseBody(req, CopilotAskRequestSchema);
  if (user) {
    await enforceRateLimit(db, COPILOT_LIMITS.researcher, user.id);
  } else {
    await enforceRateLimit(db, COPILOT_LIMITS.publicIp, clientIp(req));
    await enforceRateLimit(db, COPILOT_LIMITS.publicGlobal, "all");
    // The public route answers from the public dataset only: no request scoping.
    if (body.bounty_id) throw forbidden("Sign in as a researcher to ask about a specific request.");
  }
  const answer = await askData(db, body, {
    audience: user ? "researcher" : "public",
    owns: (b) => user !== null && (user.isAdmin || (b.created_by !== null && b.created_by === user.id)),
    origin: originOf(req),
    mockError: mockVariantOf(req) === "error",
  });
  return json(answer, { headers: { "cache-control": "no-store" } });
}
