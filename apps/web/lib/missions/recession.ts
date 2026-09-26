/**
 * Recession series: for each chain root on a request, the root reading + every accepted reading
 * linked to it (submissions.revisit_of), as (minutes since the root, value of the protocol's
 * corroboration field — flood: depth_cm). Researcher view (same rows as the submission stream).
 */
import type { Protocol, RecessionSeries } from "@groundtruth/shared";
import type { Db } from "../db";
import { toIso } from "../db/types";

export async function recessionSeries(db: Db, bountyId: string, protocol: Protocol, limit = 30): Promise<RecessionSeries[]> {
  const roots = await db.query<{ source_submission_id: string }>(
    `select source_submission_id from public.missions where bounty_id = $1
      group by source_submission_id order by max(created_at) desc limit $2`,
    [bountyId, limit],
  );
  if (roots.length === 0) return [];
  const ids = roots.map((r) => r.source_submission_id);
  const rows = await db.query<{ id: string; h3_cell: string; captured_at: unknown; extracted: Record<string, unknown> | null; root: string }>(
    `select id, h3_cell, captured_at, extracted, coalesce(revisit_of, id) as root
       from public.submissions
      where status = 'accepted' and bounty_id = $2 and (id = any($1::uuid[]) or revisit_of = any($1::uuid[]))
      order by captured_at`,
    [ids, bountyId],
  );
  const field = protocol.acceptance.corroboration_field ?? null;
  const out: RecessionSeries[] = [];
  for (const root of ids) {
    const pts = rows.filter((r) => r.root === root);
    const first = pts.find((p) => p.id === root);
    if (!first) continue;
    const t0 = Date.parse(toIso(first.captured_at));
    out.push({
      root_submission_id: root,
      cell: first.h3_cell,
      field,
      points: pts.map((p) => {
        const v = field ? p.extracted?.[field] : undefined;
        const at = toIso(p.captured_at);
        return {
          submission_id: p.id,
          captured_at: at,
          minutes: Math.max(0, Math.round((Date.parse(at) - t0) / 60_000)),
          value: typeof v === "number" && Number.isFinite(v) ? v : null,
        };
      }),
    });
  }
  return out;
}
