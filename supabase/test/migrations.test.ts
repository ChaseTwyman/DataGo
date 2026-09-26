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
    await db.query(`insert into auth.users (id, is_anonymous, email) values ($1, false, $2)`, [id, `${id.slice(-4)}@test.local`]);
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

  it("new auth users get contributor profiles via trigger", async () => {
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

describe("open data (20260926000004)", () => {
  it("demo bounty carries the demo sponsor from the seed", async () => {
    const r = await db.query<{ sponsor_name: string | null; sponsor_url: string | null }>(
      "select sponsor_name, sponsor_url from public.bounties where id = $1",
      [DEMO.bountyId],
    );
    expect(r.rows[0]).toEqual({ sponsor_name: DEMO.sponsorName, sponsor_url: DEMO.sponsorUrl });
  });

  it("re-running the seed keeps an existing sponsor and still converges", async () => {
    await db.query("update public.bounties set sponsor_name = 'Kept Sponsor' where id = $1", [DEMO.bountyId]);
    await db.exec(readFileSync(join(root, "seed.sql"), "utf8"));
    const r = await db.query<{ sponsor_name: string }>("select sponsor_name from public.bounties where id = $1", [DEMO.bountyId]);
    expect(r.rows[0]?.sponsor_name).toBe("Kept Sponsor");
    await db.query("update public.bounties set sponsor_name = null where id = $1", [DEMO.bountyId]);
    await db.exec(readFileSync(join(root, "seed.sql"), "utf8"));
    const r2 = await db.query<{ sponsor_name: string }>("select sponsor_name from public.bounties where id = $1", [DEMO.bountyId]);
    expect(r2.rows[0]?.sponsor_name).toBe(DEMO.sponsorName);
  });

  it("creates a random 64-hex public dataset salt", async () => {
    const r = await db.query<{ value: string }>("select value from public.app_settings where key = 'public_dataset_salt'");
    expect(r.rows[0]?.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("app_settings is invisible to signed-in users (RLS, no policies)", async () => {
    await asUser(CONTRIB_A, async () => {
      const r = await db.query("select key from public.app_settings");
      expect(r.rows).toHaveLength(0);
    });
  });

  it("rejects over-long sponsor names", async () => {
    await expect(
      db.query("update public.bounties set sponsor_name = $2 where id = $1", [DEMO.bountyId, "x".repeat(121)]),
    ).rejects.toThrow(/bounties_sponsor_name_len/);
  });
});

describe("verification hardening (20260926000005)", () => {
  const migration = () => readFileSync(join(root, "migrations", "20260926000005_verification_hardening.sql"), "utf8");

  async function sub(opts: { verifier?: string; confidence?: number | null; status?: string; device?: string; reviewed?: boolean }) {
    const r = await db.query<{ id: string }>(
      `insert into public.submissions (bounty_id, user_id, media, lat, lng, h3_cell, captured_at, status, confidence, device, reviewed_at, verifier)
       values ($1, $2, '[]'::jsonb, $3, $4, 'cell', now(), $5, $6, $7::jsonb, $8, $9) returning id`,
      [
        DEMO.bountyId, CONTRIB_A, DEMO.lat, DEMO.lng, opts.status ?? "accepted", opts.confidence ?? 0.9,
        JSON.stringify({ model: opts.device ?? "iPhone", os: "ios" }), opts.reviewed ? new Date().toISOString() : null, opts.verifier ?? "model",
      ],
    );
    return r.rows[0]!.id;
  }

  it("verifier defaults to 'model' and only accepts model|mock|human|none", async () => {
    const r = await db.query<{ verifier: string }>(
      `insert into public.submissions (bounty_id, user_id, media, lat, lng, h3_cell, captured_at)
       values ($1, $2, '[]'::jsonb, 0, 0, 'c', now()) returning verifier`,
      [DEMO.bountyId, CONTRIB_A],
    );
    expect(r.rows[0]?.verifier).toBe("model");
    await expect(sub({ verifier: "grok" })).rejects.toThrow(/submissions_verifier_check/);
  });

  it("the export view drops mock/none rows and tiers the rest", async () => {
    const ids = {
      model: await sub({ verifier: "model", confidence: 0.8 }),
      modelLow: await sub({ verifier: "model", confidence: 0.6 }),
      human: await sub({ verifier: "human", confidence: 0.55 }),
      mock: await sub({ verifier: "mock", confidence: 0.99 }),
      none: await sub({ verifier: "none", confidence: 0.99 }),
      review: await sub({ verifier: "model", status: "needs_review" }),
    };
    const r = await db.query<{ observation_id: string; verifier: string; quality_tier: string | null }>(
      "select observation_id, verifier, quality_tier from public.observations_export where observation_id = any($1::uuid[])",
      [Object.values(ids)],
    );
    const by = new Map(r.rows.map((x) => [x.observation_id, x]));
    expect(by.get(ids.model)?.quality_tier).toBe("model_high");
    expect(by.get(ids.modelLow)?.quality_tier).toBeNull();
    expect(by.get(ids.human)?.quality_tier).toBe("human_verified");
    expect(by.has(ids.mock)).toBe(false);
    expect(by.has(ids.none)).toBe(false);
    expect(by.has(ids.review)).toBe(false);
  });

  it("is idempotent and backfills seed rows to 'none' and reviewed rows to 'human'", async () => {
    const seed = await sub({ verifier: "model", device: "seed-script" });
    const demo = await sub({ verifier: "model", device: "demo-seed" });
    const reviewed = await sub({ verifier: "model", reviewed: true });
    const plain = await sub({ verifier: "model" });
    await db.exec(migration());
    const r = await db.query<{ id: string; verifier: string }>("select id, verifier from public.submissions where id = any($1::uuid[])", [
      [seed, demo, reviewed, plain],
    ]);
    const v = new Map(r.rows.map((x) => [x.id, x.verifier]));
    expect([v.get(seed), v.get(demo), v.get(reviewed), v.get(plain)]).toEqual(["none", "none", "human", "model"]);
  });

  it("adds server-side gate columns that contributors cannot write", async () => {
    const r = await db.query<{ id: string; green_streak: number; gate_passed_at: Date | null }>(
      `insert into public.capture_sessions (bounty_id, user_id, nonce, challenge, cell, price_quote_cents, quote_expires_at, expires_at)
       values ($1, $2, 'nonce-gate-1', '{}'::jsonb, 'c', 500, now() + interval '15 min', now() + interval '15 min')
       returning id, green_streak, gate_passed_at`,
      [DEMO.bountyId, CONTRIB_A],
    );
    expect(r.rows[0]).toMatchObject({ green_streak: 0, gate_passed_at: null });
    const sid = r.rows[0]!.id;
    const subId = await sub({ verifier: "mock" });
    await asUser(CONTRIB_A, async () => {
      await db.query("update public.capture_sessions set gate_passed_at = now(), green_streak = 9 where id = $1", [sid]);
      await db.query("update public.submissions set verifier = 'human' where id = $1", [subId]);
    });
    const after = await db.query<{ green_streak: number; gate_passed_at: Date | null }>(
      "select green_streak, gate_passed_at from public.capture_sessions where id = $1",
      [sid],
    );
    expect(after.rows[0]).toEqual({ green_streak: 0, gate_passed_at: null });
    const v = await db.query<{ verifier: string }>("select verifier from public.submissions where id = $1", [subId]);
    expect(v.rows[0]?.verifier).toBe("mock");
  });

  it("patches the flood protocol's extraction rules on a database seeded before them", async () => {
    await db.query("update public.protocols set definition = definition #- '{acceptance,extraction_rules}' where id = $1", [DEMO.protocolId]);
    await db.exec(migration());
    const r = await db.query<{ definition: unknown }>("select definition from public.protocols where id = $1", [DEMO.protocolId]);
    expect(r.rows[0]?.definition).toEqual(streetFloodDepth);
  });
});

describe("accounts (20260926000006)", () => {
  const migration = () => readFileSync(join(root, "migrations", "20260926000006_accounts.sql"), "utf8");
  let n = 0;
  async function account(opts: { researcher?: boolean; admin?: boolean; anonymous?: boolean; suspended?: boolean } = {}) {
    const id = `00000000-0000-4000-8000-0000000c${String(++n).padStart(4, "0")}`;
    await db.query(`insert into auth.users (id, is_anonymous, email) values ($1, $2, $3)`, [id, opts.anonymous ?? false, opts.anonymous ? null : `u${n}@t.local`]);
    await db.query(
      "update public.profiles set is_researcher = $2, is_admin = $3, suspended_at = case when $4 then now() end where id = $1",
      [id, opts.researcher ?? false, opts.admin ?? false, opts.suspended ?? false],
    );
    return id;
  }
  async function bountyOf(owner: string) {
    const r = await db.query<{ id: string }>(
      `insert into public.bounties (protocol_id, created_by, title, area, center_lat, center_lng, radius_m, ends_at, base_price_cents, max_price_cents, status)
       values ($1, $2, 'b', '{}'::jsonb, 0, 0, 100, now() + interval '1 day', 100, 200, 'draft') returning id`,
      [DEMO.protocolId, owner],
    );
    return r.rows[0]!.id;
  }
  async function subOn(bounty: string, user: string) {
    const r = await db.query<{ id: string }>(
      `insert into public.submissions (bounty_id, user_id, media, lat, lng, h3_cell, captured_at) values ($1, $2, '[]'::jsonb, 0, 0, 'c', now()) returning id`,
      [bounty, user],
    );
    return r.rows[0]!.id;
  }
  const roleOf = async (id: string) =>
    (await db.query<{ role: string }>("select role::text as role from public.profiles where id = $1", [id])).rows[0]?.role;

  it("backfills flags from the seeded admin role and keeps role in sync with flags", async () => {
    const r = await db.query<{ role: string; is_admin: boolean; is_researcher: boolean }>(
      "select role::text as role, is_admin, is_researcher from public.profiles where id = $1",
      [DEMO.researcherId],
    );
    expect(r.rows[0]).toEqual({ role: "admin", is_admin: true, is_researcher: true });
    const id = await account({ researcher: true });
    expect(await roleOf(id)).toBe("researcher");
    await db.query("update public.profiles set role = 'admin' where id = $1", [id]); // legacy writer
    const l = await db.query<{ is_admin: boolean; is_researcher: boolean }>("select is_admin, is_researcher from public.profiles where id = $1", [id]);
    expect(l.rows[0]).toEqual({ is_admin: true, is_researcher: true });
    await db.query("update public.profiles set is_admin = false, is_researcher = false where id = $1", [id]);
    expect(await roleOf(id)).toBe("contributor");
  });

  it("backfill on an old database: role enum → flags (researcher, admin)", async () => {
    const r = await account();
    const a = await account();
    // simulate pre-000006 rows: role set, flags false (bypass the trigger)
    await db.exec("alter table public.profiles disable trigger profiles_sync_role");
    await db.query("update public.profiles set role = 'researcher', is_researcher = false where id = $1", [r]);
    await db.query("update public.profiles set role = 'admin', is_admin = false, is_researcher = false where id = $1", [a]);
    await db.exec("alter table public.profiles enable trigger profiles_sync_role");
    await db.exec(migration());
    const rows = await db.query<{ id: string; is_admin: boolean; is_researcher: boolean; role: string }>(
      "select id, is_admin, is_researcher, role::text as role from public.profiles where id = any($1::uuid[]) order by id",
      [[r, a]],
    );
    expect(rows.rows).toEqual([
      { id: r, is_admin: false, is_researcher: true, role: "researcher" },
      { id: a, is_admin: true, is_researcher: true, role: "admin" },
    ]);
  });

  it("a researcher can't read another researcher's bounty submissions; an admin can", async () => {
    const r1 = await account({ researcher: true });
    const r2 = await account({ researcher: true });
    const admin = await account({ admin: true });
    const c = await account();
    const b1 = await bountyOf(r1);
    const s1 = await subOn(b1, c);
    await asUser(r2, async () => {
      expect((await db.query("select id from public.submissions where id = $1", [s1])).rows).toHaveLength(0);
      expect((await db.query("select id from public.bounties where id = $1", [b1])).rows).toHaveLength(0);
    });
    await asUser(r1, async () => {
      expect((await db.query("select id from public.submissions where id = $1", [s1])).rows).toHaveLength(1);
    });
    await asUser(admin, async () => {
      expect((await db.query("select id from public.submissions where id = $1", [s1])).rows).toHaveLength(1);
    });
  });

  it("a creator whose researcher flag was revoked loses bounty-owner reads", async () => {
    const r = await account({ researcher: true });
    const c = await account();
    const s = await subOn(await bountyOf(r), c);
    await db.query("update public.profiles set is_researcher = false where id = $1", [r]);
    await asUser(r, async () => {
      expect((await db.query("select id from public.submissions where id = $1", [s])).rows).toHaveLength(0);
    });
  });

  it("suspended and anonymous users read nothing, not even their own rows", async () => {
    for (const opts of [{ suspended: true }, { anonymous: true }]) {
      const u = await account(opts);
      await subOn(DEMO.bountyId, u);
      await asUser(u, async () => {
        expect((await db.query("select id from public.submissions")).rows).toHaveLength(0);
        expect((await db.query("select id from public.profiles")).rows).toHaveLength(0);
        expect((await db.query("select id from public.bounties")).rows).toHaveLength(0);
      });
    }
  });

  it("a suspended admin is not an admin", async () => {
    const a = await account({ admin: true, suspended: true });
    await asUser(a, async () => {
      expect((await db.query<{ v: boolean }>("select public.is_admin() as v")).rows[0]?.v).toBe(false);
      expect((await db.query("select id from public.submissions")).rows).toHaveLength(0);
    });
  });

  it("users cannot grant themselves researcher/admin (no profiles UPDATE policy)", async () => {
    const u = await account();
    await asUser(u, async () => {
      await db.query("update public.profiles set is_admin = true, is_researcher = true where id = $1", [u]);
    });
    const r = await db.query<{ is_admin: boolean; is_researcher: boolean }>("select is_admin, is_researcher from public.profiles where id = $1", [u]);
    expect(r.rows[0]).toEqual({ is_admin: false, is_researcher: false });
  });

  it("creates the suspended deleted-user placeholder, idempotently", async () => {
    await db.exec(migration());
    const r = await db.query<{ display_name: string; suspended: boolean; is_admin: boolean; email: string | null }>(
      `select p.display_name, p.suspended_at is not null as suspended, p.is_admin, u.email
         from public.profiles p join auth.users u on u.id = p.id where p.id = $1`,
      [DEMO.deletedUserId],
    );
    expect(r.rows).toEqual([{ display_name: "Deleted user", suspended: true, is_admin: false, email: null }]);
  });

  it("rate_limit_hit counts per key inside a window; rate_limits is invisible to users", async () => {
    const hit = async (k: string) => (await db.query<{ n: number }>("select public.rate_limit_hit($1, 3600) as n", [k])).rows[0]?.n;
    expect(await hit("t:a")).toBe(1);
    expect(await hit("t:a")).toBe(2);
    expect(await hit("t:b")).toBe(1);
    const u = await account();
    await asUser(u, async () => {
      // The migration revokes all privileges (permission denied); the test shim re-grants them, and
      // then RLS with no policies returns nothing. Either way a user can't read the table.
      const rows = await db.query("select key from public.rate_limits").then(
        (r) => r.rows,
        (e: unknown) => {
          expect(String(e)).toMatch(/permission denied/);
          return [];
        },
      );
      expect(rows).toHaveLength(0);
    });
  });

  it("adds submissions.media_purged_at", async () => {
    const r = await db.query<{ media_purged_at: Date | null }>(
      `insert into public.submissions (bounty_id, user_id, media, lat, lng, h3_cell, captured_at) values ($1, $2, '[]'::jsonb, 0, 0, 'c', now()) returning media_purged_at`,
      [DEMO.bountyId, CONTRIB_A],
    );
    expect(r.rows[0]?.media_purged_at).toBeNull();
  });
});

describe("sponsor pool (20260926000007)", () => {
  const migration = () => readFileSync(join(root, "migrations", "20260926000007_sponsor_pool.sql"), "utf8");
  const one = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  async function bounty(budget: number, status = "active") {
    return (
      await one<{ id: string }>(
        `insert into public.bounties (protocol_id, created_by, title, area, center_lat, center_lng, radius_m, ends_at, base_price_cents, max_price_cents, budget_cents, status)
         values ($1, $2, 'b', '{}'::jsonb, 0, 0, 100, now() + interval '1 day', 100, 200, $3, $4::public.bounty_status) returning id`,
        [DEMO.protocolId, DEMO.researcherId, budget, status],
      )
    ).id;
  }
  async function sponsor(name: string) {
    return (await one<{ id: string }>("insert into public.sponsors (name) values ($1) returning id", [name])).id;
  }
  async function contribute(sponsorId: string, cents: number, earmark: { bounty_id?: string; protocol_slug?: string } = {}) {
    return (
      await one<{ id: string }>(
        "insert into public.sponsor_contributions (sponsor_id, amount_cents, bounty_id, protocol_slug) values ($1, $2, $3, $4) returning id",
        [sponsorId, cents, earmark.bounty_id ?? null, earmark.protocol_slug ?? null],
      )
    ).id;
  }
  const allocate = async (b: string, c: string | null, cents: number, kind = "allocate") =>
    (await one<{ ok: boolean }>("select public.pool_allocate($1, $2, $3, $4, 'test', null) as ok", [b, c, cents, kind])).ok;
  const available = async (c: string | null) => Number((await one<{ n: string }>("select public.pool_bucket_available($1) as n", [c])).n);
  const budgetOf = async (b: string) => (await one<{ budget_cents: number }>("select budget_cents from public.bounties where id = $1", [b])).budget_cents;

  it("migrates the seeded demo bounty as already funded by an earmarked contribution of its budget", async () => {
    const b = await one<{ status: string; budget_cents: number; funded: boolean }>(
      "select status::text as status, budget_cents, funded_at is not null as funded from public.bounties where id = $1",
      [DEMO.bountyId],
    );
    expect(b).toEqual({ status: "active", budget_cents: DEMO.budgetCents, funded: true });
    const c = await db.query<{ amount_cents: number; name: string }>(
      "select c.amount_cents, s.name from public.sponsor_contributions c join public.sponsors s on s.id = c.sponsor_id where c.bounty_id = $1",
      [DEMO.bountyId],
    );
    expect(c.rows).toEqual([{ amount_cents: DEMO.budgetCents, name: DEMO.sponsorName }]);
    const a = await one<{ n: number; kind: string }>(
      "select sum(amount_cents)::int as n, min(kind) as kind from public.pool_allocations where bounty_id = $1",
      [DEMO.bountyId],
    );
    expect(a).toEqual({ n: DEMO.budgetCents, kind: "migrated" });
  });

  it("backfill on an old database: funded bounties gain contributions once; re-running changes nothing", async () => {
    const old = await bounty(7_000);
    const draft = await bounty(0, "draft");
    await db.exec(migration());
    await db.exec(migration());
    const rows = await db.query<{ bounty_id: string; n: number }>(
      "select bounty_id, sum(amount_cents)::int as n from public.pool_allocations where bounty_id = any($1::uuid[]) group by 1",
      [[old, draft]],
    );
    expect(rows.rows).toEqual([{ bounty_id: old, n: 7_000 }]);
    expect(await budgetOf(old)).toBe(7_000);
    const f = await one<{ funded: boolean; status: string }>("select funded_at is not null as funded, status::text as status from public.bounties where id = $1", [old]);
    expect(f).toEqual({ funded: true, status: "active" });
  });

  it("adds the pending_funding status and request columns", async () => {
    const b = await bounty(0, "pending_funding");
    await db.query("update public.bounties set justification = 'why', funding_reason = 'pool empty' where id = $1", [b]);
    const r = await one<{ status: string; justification: string }>("select status::text as status, justification from public.bounties where id = $1", [b]);
    expect(r).toEqual({ status: "pending_funding", justification: "why" });
  });

  it("pool_allocate moves money atomically between buckets and requests and keeps budget = allocations", async () => {
    const s = await sponsor("Pool test sponsor");
    const general0 = await available(null);
    await contribute(s, 1_000);
    expect(await available(null)).toBe(general0 + 1_000);
    const b = await bounty(0, "pending_funding");
    expect(await allocate(b, null, general0 + 600)).toBe(true);
    expect(await budgetOf(b)).toBe(general0 + 600);
    expect(await allocate(b, null, 500)).toBe(false); // only 400 left
    expect(await available(null)).toBe(400);
    // release: can't go below what's spent
    await db.query("select public.spend_bounty_budget($1, 300)", [b]);
    expect(await allocate(b, null, -(general0 + 400))).toBe(false);
    expect(await allocate(b, null, -200, "release")).toBe(true);
    expect(await budgetOf(b)).toBe(general0 + 400);
    expect(await available(null)).toBe(600);
    // an earmark for another request can't be drawn here
    const other = await bounty(0, "pending_funding");
    const e = await contribute(s, 500, { bounty_id: other });
    expect(await allocate(b, e, 100)).toBe(false);
    expect(await allocate(other, e, 500)).toBe(true);
    expect(await available(e)).toBe(0);
  });

  it("ledgers are append-only; corrections are reversals limited to unallocated money", async () => {
    const s = await sponsor("Reversal sponsor");
    const c = await contribute(s, 800, { protocol_slug: "street-flood-depth" });
    await expect(db.query("update public.sponsor_contributions set amount_cents = 1 where id = $1", [c])).rejects.toThrow(/APPEND_ONLY/);
    await expect(db.query("delete from public.sponsor_contributions where id = $1", [c])).rejects.toThrow(/APPEND_ONLY/);
    const b = await bounty(0, "pending_funding");
    expect(await allocate(b, c, 500)).toBe(true);
    await expect(db.query("delete from public.pool_allocations where bounty_id = $1", [b])).rejects.toThrow(/APPEND_ONLY/);
    const rev = async (n: number) => (await one<{ id: string | null }>("select public.pool_reverse_contribution($1, $2, 'typo', null) as id", [c, n])).id;
    expect(await rev(400)).toBeNull(); // only 300 unallocated
    expect(await rev(300)).not.toBeNull();
    expect(await available(c)).toBe(0);
    const bucket = await one<{ contributed_cents: unknown; allocated_cents: unknown; available_cents: unknown }>(
      "select contributed_cents::int as contributed_cents, allocated_cents::int as allocated_cents, available_cents::int as available_cents from public.pool_buckets where contribution_id = $1",
      [c],
    );
    expect(bucket).toEqual({ contributed_cents: 500, allocated_cents: 500, available_cents: 0 });
  });

  it("pool_buckets reports the general pool and attributes spend to buckets", async () => {
    const g = await one<{ contributed: number; allocated: number; available: number; paid: number }>(
      `select contributed_cents::int as contributed, allocated_cents::int as allocated, available_cents::int as available, paid_cents::int as paid
         from public.pool_buckets where contribution_id is null`,
    );
    expect(g.contributed - g.allocated).toBe(g.available);
    expect(g.paid).toBeGreaterThanOrEqual(300);
  });

  it("pool and budget functions refuse callers with a JWT subject (PostgREST RPC)", async () => {
    const b = await bounty(0, "pending_funding");
    await asUser(CONTRIB_A, async () => {
      await expect(db.query("select public.pool_allocate($1, null, 1, 'allocate', null, null)", [b])).rejects.toThrow(/SERVER_ONLY|permission denied/);
      await expect(db.query("select public.spend_bounty_budget($1, 1)", [DEMO.bountyId])).rejects.toThrow(/SERVER_ONLY|permission denied/);
      await expect(db.query("select public.pool_backfill_legacy()")).rejects.toThrow(/SERVER_ONLY|permission denied/);
      const rows = await db.query("select id from public.sponsor_contributions").then(
        (r) => r.rows,
        () => [],
      );
      expect(rows).toHaveLength(0);
    });
  });
});

describe("migration 000008 (grokbot)", () => {
  it("adds grokbot_cache (server-only: invisible and unwritable for signed-in users) and protocols.self_check", async () => {
    await db.query(
      `insert into public.grokbot_cache (kind, subject_id, audience, version, payload, source, expires_at)
       values ('explain', 's1', 'contributor', 'v1', '{"headline":"x"}', 'template', now() + interval '1 hour')`,
    );
    await expect(
      db.query(`insert into public.grokbot_cache (kind, subject_id, audience, version, payload, source, expires_at)
                values ('explain', 's1', 'someone', 'v1', '{}', 'template', now())`),
    ).rejects.toThrow();
    await asUser(CONTRIB_A, async () => {
      const r = await db.query("select kind from public.grokbot_cache").then(
        (x) => x.rows,
        () => [],
      );
      expect(r).toHaveLength(0);
      await expect(
        db.query(`insert into public.grokbot_cache (kind, subject_id, audience, version, payload, source, expires_at)
                  values ('explain', 's2', 'public', 'v1', '{}', 'grok', now())`),
      ).rejects.toThrow();
    });
    const col = await db.query<{ data_type: string }>(
      "select data_type from information_schema.columns where table_schema = 'public' and table_name = 'protocols' and column_name = 'self_check'",
    );
    expect(col.rows[0]?.data_type).toBe("jsonb");
  });

  it("adds missions + impact_cards (server-only), submissions.revisit_of/mission_id, and the flood revisit schedule", async () => {
    const proto = await db.query<{ r: unknown }>("select definition->'revisit' as r from public.protocols where slug = 'street-flood-depth'");
    expect(proto.rows[0]?.r).toMatchObject({ intervals_min: [30, 60, 120], max: 3 });
    const cols = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name in ('revisit_of', 'mission_id')",
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["mission_id", "revisit_of"]);
    // window sanity is enforced by the table
    await expect(
      db.query(`insert into public.missions (bounty_id, cell, source_submission_id, sequence, interval_min, opens_at, due_at, dibs_until, closes_at)
                values ($1, 'x', gen_random_uuid(), 1, 30, now(), now() - interval '1 minute', now(), now())`, [DEMO.bountyId]),
    ).rejects.toThrow();
    await expect(db.query(`insert into public.impact_cards (submission_id, path) values (gen_random_uuid(), 'observations/x.png')`)).rejects.toThrow();
    await asUser(CONTRIB_A, async () => {
      for (const t of ["missions", "impact_cards"]) {
        const r = await db.query(`select 1 from public.${t}`).then(
          (x) => x.rows,
          () => [],
        );
        expect(r).toHaveLength(0);
      }
      await expect(
        db.query(`insert into public.missions (bounty_id, cell, source_submission_id, sequence, interval_min, opens_at, due_at, dibs_until, closes_at)
                  values ($1, 'x', gen_random_uuid(), 1, 30, now(), now(), now(), now())`, [DEMO.bountyId]),
      ).rejects.toThrow();
    });
  });
});

describe("migration 000009 (redaction)", () => {
  const migration = () => readFileSync(join(root, "migrations", "20260926000009_redaction.sql"), "utf8");
  let n = 0;
  async function account(opts: { researcher?: boolean; admin?: boolean } = {}) {
    const id = `00000000-0000-4000-8000-0000000d${String(++n).padStart(4, "0")}`;
    await db.query(`insert into auth.users (id, is_anonymous, email) values ($1, false, $2)`, [id, `r${n}@t.local`]);
    await db.query("update public.profiles set is_researcher = $2, is_admin = $3 where id = $1", [id, opts.researcher ?? false, opts.admin ?? false]);
    return id;
  }

  it("adds submissions.redaction and is idempotent", async () => {
    await db.exec(migration());
    const col = await db.query<{ data_type: string }>(
      "select data_type from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'redaction'",
    );
    expect(col.rows[0]?.data_type).toBe("jsonb");
  });

  it("media guard refuses a redacted_path outside the observations bucket", async () => {
    const ok = `[{"path":"observations/${CONTRIB_A}/s/0.jpg","redacted_path":"observations/${CONTRIB_A}/s/0.redacted.jpg","captured_at":"2026-09-26T00:00:00Z"}]`;
    const bad = `[{"path":"observations/${CONTRIB_A}/s/0.jpg","redacted_path":"synthetic/x.jpg","captured_at":"2026-09-26T00:00:00Z"}]`;
    const ins = (media: string) =>
      db.query(`insert into public.submissions (bounty_id, user_id, media, lat, lng, h3_cell, captured_at) values ($1, $2, $3::jsonb, 0, 0, 'c', now())`, [
        DEMO.bountyId,
        CONTRIB_A,
        media,
      ]);
    await expect(ins(ok)).resolves.toBeTruthy();
    await expect(ins(bad)).rejects.toThrow(/SYNTHETIC_MEDIA/);
  });

  it("storage: non-admin researchers read only redacted derivatives; admins and the owner read originals", async () => {
    // Real Supabase has RLS on storage.objects; the shim table doesn't, so turn it on here.
    await db.exec("alter table storage.objects enable row level security; grant select on storage.objects to authenticated;");
    const owner = await account();
    const researcher = await account({ researcher: true });
    const admin = await account({ researcher: true, admin: true });
    const stranger = await account();
    const orig = `${owner}/s1/0.jpg`;
    const red = `${owner}/s1/0.redacted.jpg`;
    await db.query("insert into storage.objects (bucket_id, name) values ('observations', $1), ('observations', $2)", [orig, red]);
    const visible = async (uid: string) => {
      let names: string[] = [];
      await asUser(uid, async () => {
        names = (await db.query<{ name: string }>("select name from storage.objects where bucket_id = 'observations' and name like $1 order by name", [`${owner}/%`])).rows.map(
          (r) => r.name,
        );
      });
      return names;
    };
    expect(await visible(researcher)).toEqual([red]);
    expect(await visible(admin)).toEqual([orig, red]);
    expect(await visible(owner)).toEqual([orig, red]);
    expect(await visible(stranger)).toEqual([]);
  });
});
