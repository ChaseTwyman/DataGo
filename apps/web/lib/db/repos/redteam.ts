import type { AttackType } from "@groundtruth/shared";
import { json, toIso, type Db } from "../types";

export async function insertSyntheticMedia(
  db: Db,
  m: { kind: "example" | "briefing" | "redteam" | "impact"; path: string; prompt: string | null; model: string | null },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.synthetic_media (kind, path, prompt, model) values ($1::public.synthetic_kind, $2, $3, $4) returning id",
    [m.kind, m.path, m.prompt, m.model],
  );
  return rows[0]!.id;
}

export interface RedteamRecord {
  id: string;
  bounty_id: string;
  attack_type: AttackType;
  synthetic_media_id: string | null;
  source_submission_id: string | null;
  pipeline_result: {
    status: string;
    reason_codes: string[];
    checks: unknown[];
    confidence?: number;
    image_path?: string | null;
  };
  caught: boolean;
  created_at: string;
}

export async function insertRedteamRun(
  db: Db,
  r: Omit<RedteamRecord, "id" | "created_at">,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.redteam_runs (bounty_id, attack_type, synthetic_media_id, source_submission_id, pipeline_result, caught)
     values ($1, $2::public.attack_type, $3, $4, $5::jsonb, $6) returning id`,
    [r.bounty_id, r.attack_type, r.synthetic_media_id, r.source_submission_id, json(r.pipeline_result), r.caught],
  );
  return rows[0]!.id;
}

export async function listRedteamRuns(db: Db, bountyIds: string[] | null, bountyId?: string): Promise<RedteamRecord[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select id, bounty_id, attack_type::text as attack_type, synthetic_media_id, source_submission_id, pipeline_result, caught, created_at
       from public.redteam_runs
      where ($1::uuid[] is null or bounty_id = any($1::uuid[])) and ($2::uuid is null or bounty_id = $2::uuid)
      order by created_at desc limit 200`,
    [bountyIds, bountyId ?? null],
  );
  return rows.map((r) => ({ ...(r as unknown as RedteamRecord), created_at: toIso(r.created_at) }));
}
