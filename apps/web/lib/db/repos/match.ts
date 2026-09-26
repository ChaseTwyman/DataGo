import type { Db } from "../types";

export async function matchScores(db: Db, userId: string): Promise<Map<string, { skill_fit: number; reason: string | null }>> {
  const rows = await db.query<{ bounty_id: string; skill_fit: number; reason: string | null }>(
    "select bounty_id, skill_fit, reason from public.match_cache where user_id = $1",
    [userId],
  );
  return new Map(rows.map((r) => [r.bounty_id, { skill_fit: r.skill_fit, reason: r.reason }]));
}
