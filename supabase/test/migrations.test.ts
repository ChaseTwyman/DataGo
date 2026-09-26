/**
 * Applies every migration + seed.sql to PGlite (in-process Postgres) with a small shim for the
 * Supabase-managed schemas (auth, storage, roles). This is the headless stand-in for
 * `supabase db reset`, which needs Docker. It catches SQL errors, seed drift, and RLS mistakes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { DEMO, streetFloodDepth } from "@groundtruth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

import { applySupabaseSchema } from "./shim";

let db: PGlite;

async function asUser(uid: string, fn: () => Promise<void>) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const CONTRIB_A = "00000000-0000-4000-8000-00000000aaaa";
const CONTRIB_B = "00000000-0000-4000-8000-00000000bbbb";

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  const migDir = join(root, "migrations");
  const migrations = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migDir, f), "utf8"));
  await applySupabaseSchema(db, { migrations, seed: readFileSync(join(root, "seed.sql"), "utf8") });
  for (const id of [CONTRIB_A, CONTRIB_B]) {
    await db.query(`insert into auth.users (id, is_anonymous) values ($1, true)`, [id]);
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migrations + seed", () => {
  it("seeds an admin researcher with a profile", async () => {
    const r = await db.query<{ role: string; trust_score: number }>(
      "select role, trust_score from public.profiles where id = $1",
      [DEMO.researcherId],
    );
    expect(r.rows[0]).toEqual({ role: "admin", trust_score: 0.5 });
  });

  it("anonymous users get contributor profiles via trigger", async () => {
    const r = await db.query<{ role: string }>("select role from public.profiles where id = $1", [CONTRIB_A]);
    expect(r.rows[0]?.role).toBe("contributor");
  });

  it("seeded protocol matches packages/shared exactly (no drift)", async () => {
    const r = await db.query<{ definition: unknown; status: string }>(
      "select definition, status from public.protocols where id = $1",
      [DEMO.protocolId],
    );
    expect(r.rows[0]?.status).toBe("published");
    expect(r.rows[0]?.definition).toEqual(streetFloodDepth);
  });

  it("seeds one active demo bounty with H3 cells", async () => {
    const r = await db.query<{ status: string; n: number; event_started_at: Date | null }>(
      "select status, cardinality(cells) as n, event_started_at from public.bounties where id = $1",
      [DEMO.bountyId],
    );
    expect(r.rows[0]?.status).toBe("active");
    expect(r.rows[0]?.n).toBeGreaterThan(5);
    expect(r.rows[0]?.event_started_at).not.toBeNull();
  });

  it("creates both storage buckets and the realtime publication", async () => {
    const b = await db.query<{ id: string; public: boolean }>("select id, public from storage.buckets order by id");
    expect(b.rows).toEqual([
      { id: "observations", public: false },
      { id: "synthetic", public: true },
    ]);
    const p = await db.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename",
    );
    expect(p.rows.map((r) => r.tablename)).toEqual(["bounties", "submissions"]);
  });
});

async function insertSubmission(userId: string, status: string, mediaPath = "observations/x/y/0.jpg") {
  const r = await db.query<{ id: string }>(
    `insert into public.submissions (bounty_id, user_id, media, lat, lng, h3_cell, captured_at, status, extracted)
     values ($1, $2, $3::jsonb, $4, $5, 'cell', now(), $6, '{"depth_cm": 12}'::jsonb) returning id`,
    [DEMO.bountyId, userId, JSON.stringify([{ path: mediaPath, captured_at: new Date().toISOString() }]), DEMO.lat, DEMO.lng, status],
  );
  return r.rows[0]!.id;
}

describe("guards and helpers", () => {
  it("refuses synthetic media paths in submissions", async () => {
    await expect(insertSubmission(CONTRIB_A, "pending", "synthetic/redteam/fake.jpg")).rejects.toThrow(/SYNTHETIC_MEDIA/);
    await expect(insertSubmission(CONTRIB_A, "pending", "redteam/fake.jpg")).rejects.toThrow(/SYNTHETIC_MEDIA/);
  });

  it("spend_bounty_budget is atomic and refuses overspend", async () => {
    const ok = await db.query<{ ok: boolean }>("select public.spend_bounty_budget($1, 1000) as ok", [DEMO.bountyId]);
    expect(ok.rows[0]?.ok).toBe(true);
    const no = await db.query<{ ok: boolean }>("select public.spend_bounty_budget($1, $2) as ok", [DEMO.bountyId, DEMO.budgetCents]);
    expect(no.rows[0]?.ok).toBe(false);
    const s = await db.query<{ spent_cents: number }>("select spent_cents from public.bounties where id = $1", [DEMO.bountyId]);
    expect(s.rows[0]?.spent_cents).toBe(1000);
  });

  it("claim_frame_check allows one in flight and enforces the cap", async () => {
    const r = await db.query<{ id: string }>(
      `insert into public.capture_sessions (bounty_id, user_id, nonce, challenge, cell, price_quote_cents, quote_expires_at, expires_at)
       values ($1, $2, 'nonce-123456', '{}'::jsonb, 'c', 500, now() + interval '15 min', now() + interval '15 min') returning id`,
      [DEMO.bountyId, CONTRIB_A],
    );
    const sid = r.rows[0]!.id;
    const claim = async (user = CONTRIB_A) =>
      (await db.query<{ n: number | null }>("select public.claim_frame_check($1, $2, 2, 10) as n", [sid, user])).rows[0]?.n;
    expect(await claim()).toBe(1);
    expect(await claim()).toBeNull(); // in flight
    await db.query("select public.release_frame_check($1)", [sid]);
    expect(await claim(CONTRIB_B)).toBeNull(); // not your session
    expect(await claim()).toBe(2);
    await db.query("select public.release_frame_check($1)", [sid]);
    expect(await claim()).toBeNull(); // cap reached
  });

  it("one payout ledger entry per submission", async () => {
    const sid = await insertSubmission(CONTRIB_A, "accepted");
    await db.query("insert into public.ledger_entries (user_id, submission_id, amount_cents, kind) values ($1, $2, 500, 'payout')", [CONTRIB_A, sid]);
    await expect(
      db.query("insert into public.ledger_entries (user_id, submission_id, amount_cents, kind) values ($1, $2, 500, 'payout')", [CONTRIB_A, sid]),
    ).rejects.toThrow();
  });
});

describe("row level security", () => {
  it("contributors see active bounties and only their own submissions", async () => {
    const mine = await insertSubmission(CONTRIB_A, "pending");
    const theirs = await insertSubmission(CONTRIB_B, "pending");
    await asUser(CONTRIB_A, async () => {
      const b = await db.query("select id from public.bounties");
      expect(b.rows).toHaveLength(1);
      const s = await db.query<{ id: string }>("select id from public.submissions");
      const ids = s.rows.map((r) => r.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(theirs);
      const p = await db.query("select id from public.profiles");
      expect(p.rows).toHaveLength(1);
    });
  });

  it("contributors cannot insert bounties or read others' ledgers", async () => {
    await asUser(CONTRIB_B, async () => {
      await expect(
        db.query(
          `insert into public.bounties (protocol_id, created_by, title, area, center_lat, center_lng, radius_m, ends_at, base_price_cents, max_price_cents)
           values ($1, $2, 'x', '{}'::jsonb, 0, 0, 100, now() + interval '1 day', 100, 200)`,
          [DEMO.protocolId, CONTRIB_B],
        ),
      ).rejects.toThrow();
      const l = await db.query("select id from public.ledger_entries");
      expect(l.rows).toHaveLength(0);
    });
  });

  it("the admin researcher sees every submission and the export view", async () => {
    await asUser(DEMO.researcherId, async () => {
      const s = await db.query<{ n: number }>("select count(*)::int as n from public.submissions");
      expect(s.rows[0]!.n).toBeGreaterThanOrEqual(3);
      const e = await db.query<{ protocol_slug: string }>("select protocol_slug from public.observations_export");
      expect(e.rows.length).toBeGreaterThanOrEqual(1);
      expect(e.rows[0]?.protocol_slug).toBe("street-flood-depth");
    });
  });

  it("contributors see only their own accepted rows in the export view", async () => {
    await asUser(CONTRIB_B, async () => {
      const e = await db.query("select observation_id from public.observations_export");
      expect(e.rows).toHaveLength(0);
    });
  });
});
