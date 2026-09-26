import { route } from "@/lib/api/http";
import { handleAsk } from "@/lib/copilot/http";
import { getDb } from "@/lib/db";

export const maxDuration = 60;

/**
 * Ask the data, public (no login): questions over the open dataset only, stricter rate limits
 * (per IP + a site-wide ceiling). Same plan grammar, same coarsened rows as /api/public/datasets.
 */
export const POST = route(async (req) => handleAsk(req, await getDb(), null));
