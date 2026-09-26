import type { LedgerEntry } from "@groundtruth/shared";
import { toIso, type Db } from "../types";

export async function insertLedger(
  db: Db,
  e: { user_id: string; submission_id: string | null; amount_cents: number; kind: LedgerEntry["kind"] },
): Promise<void> {
  await db.query(
    "insert into public.ledger_entries (user_id, submission_id, amount_cents, kind) values ($1, $2, $3, $4::public.ledger_kind)",
    [e.user_id, e.submission_id, e.amount_cents, e.kind],
  );
}

export async function wallet(db: Db, userId: string): Promise<{ balance_cents: number; entries: LedgerEntry[] }> {
  const rows = await db.query<Record<string, unknown>>(
    `select l.id, l.submission_id, l.amount_cents, l.kind::text as kind, l.created_at, b.title as bounty_title
       from public.ledger_entries l
       left join public.submissions s on s.id = l.submission_id
       left join public.bounties b on b.id = s.bounty_id
      where l.user_id = $1 order by l.created_at desc limit 200`,
    [userId],
  );
  const bal = await db.query<{ n: number }>(
    "select coalesce(sum(amount_cents), 0)::int as n from public.ledger_entries where user_id = $1",
    [userId],
  );
  return {
    balance_cents: bal[0]?.n ?? 0,
    entries: rows.map((r) => ({
      id: String(r.id),
      submission_id: (r.submission_id as string | null) ?? null,
      amount_cents: Number(r.amount_cents),
      kind: r.kind as LedgerEntry["kind"],
      created_at: toIso(r.created_at),
      bounty_title: (r.bounty_title as string | null) ?? null,
    })),
  };
}
