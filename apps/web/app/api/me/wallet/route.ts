import type { WalletResponse } from "@groundtruth/shared";
import { json, route } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { wallet } from "@/lib/db/repos/ledger";

/** Simulated wallet: balance = sum of ledger entries (PRD §15). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const w = await wallet(await getDb(), user.id);
  const body: WalletResponse = { balance_cents: w.balance_cents, trust_score: user.trustScore, entries: w.entries };
  return json(body);
});
