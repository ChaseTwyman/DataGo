/**
 * Accounts, roles, admin, data rights, retention, rate limits (migration 000006) on PGlite.
 * LOCAL_BACKEND=1 uses dev tokens whose identity comes from the PGlite auth.users table, and the real
 * LocalAccountAuth (bcrypt via pgcrypto). Supabase-mode token checks use a mocked admin client.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUserSchema, DEMO, MeSchema } from "@groundtruth/shared";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as devLogin } from "@/app/api/dev/login/route";
import { POST as devSession } from "@/app/api/dev/session/route";
import { DELETE as deleteMe, GET as getMe } from "@/app/api/me/route";
import { DELETE as researcherOff, POST as researcherOn } from "@/app/api/me/researcher/route";
import { POST as changePassword } from "@/app/api/me/password/route";
import { GET as exportMe } from "@/app/api/me/export/route";
import { GET as wallet } from "@/app/api/me/wallet/route";
import { GET as adminUsers } from "@/app/api/admin/users/route";
import { PATCH as adminPatch } from "@/app/api/admin/users/[id]/route";
import { POST as adminReset } from "@/app/api/admin/users/[id]/reset-password/route";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/retention/route";
import { POST as createSession } from "@/app/api/capture/sessions/route";
import { POST as createSubmission } from "@/app/api/submissions/route";
import { GET as getSubmission } from "@/app/api/submissions/[id]/route";
import { POST as draftProtocol } from "@/app/api/protocols/draft/route";
import { POST as redteamRun } from "@/app/api/redteam/run/route";
import { GET as bountyList } from "@/app/api/bounties/route";
import { GET as publicList } from "@/app/api/public/datasets/route";
import { GET as publicDataset } from "@/app/api/public/datasets/[slug]/route";
import { setAccountAuthForTests, type AccountAuth } from "@/lib/account/authAdmin";
import { observationPseudonym, publicDatasetSalt } from "@/lib/openData";
import { purgeRejectedMedia } from "@/lib/retention";
import { idCtx, req, setupTestEnv, type TestEnv } from "./helpers";

const getUser = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => ({ auth: { getUser } }) }));

let env: TestEnv;
let admin: string; // dev token of the seeded admin
const noCtx = undefined as unknown;
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeAll(async () => {
  env = await setupTestEnv();
}, 60_000);
afterAll(async () => env.close());
beforeEach(async () => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  vi.stubEnv("DEMO_MODE", "1");
  const r = await devSession(req("POST", "/api/dev/session", { body: { role: "researcher" } }), noCtx);
  admin = ((await r.json()) as { access_token: string }).access_token;
});
afterEach(() => {
  vi.unstubAllEnvs();
  setAccountAuthForTests(null);
  getUser.mockReset();
});

let ipSeq = 0;
const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

async function signUp(opts: { email?: string; password?: string; ip?: string } = {}) {
  const email = opts.email ?? `u${randomUUID().slice(0, 8)}@example.org`;
  const password = opts.password ?? "correct horse battery";
  const r = await signup(
    req("POST", "/api/auth/signup", {
      body: { email, password, display_name: "Ada", is_adult: true, accept_terms: true },
      headers: { "x-forwarded-for": `${opts.ip ?? freshIp()}, 10.9.9.9` },
    }),
    noCtx,
  );
  return { r, email, password };
}

async function account(): Promise<{ id: string; token: string; email: string; password: string }> {
  const { r, email, password } = await signUp();
  expect(r.status).toBe(201);
  const l = await devLogin(req("POST", "/api/dev/login", { body: { email, password } }), noCtx);
  expect(l.status).toBe(200);
  const b = (await l.json()) as { user_id: string; access_token: string };
  return { id: b.user_id, token: b.access_token, email, password };
}

async function anonymousUser(): Promise<string> {
  const id = randomUUID();
  await env.db.query("insert into auth.users (id, is_anonymous) values ($1, true)", [id]);
  return `dev.${id}`;
}

async function code(r: Response): Promise<string> {
  return ((await r.json()) as { error: { code: string } }).error.code;
}

async function insertSub(userId: string, o: { status: string; verifier?: string; confidence?: number; daysAgo?: number; media?: string[] }) {
  const at = new Date(Date.now() - (o.daysAgo ?? 0) * 86_400_000).toISOString();
  const media = (o.media ?? []).map((path) => ({ path, captured_at: at }));
  const rows = await env.db.query<{ id: string }>(
    `insert into public.submissions (bounty_id, user_id, media, lat, lng, h3_cell, captured_at, received_at, status, confidence, verifier, extracted, device)
     values ($1, $2, $3::jsonb, $4, $5, '89444c0c2afffff', $6::timestamptz, $6::timestamptz, $7::public.submission_status, $8, $9, '{"depth_cm": 10}'::jsonb, '{"model":"iPhone","os":"ios"}'::jsonb)
     returning id`,
    [DEMO.bountyId, userId, JSON.stringify(media), DEMO.lat, DEMO.lng, at, o.status, o.confidence ?? 0.9, o.verifier ?? "model"],
  );
  return rows[0]!.id;
}

async function photo(userId: string, name = randomUUID()): Promise<string> {
  const p = `observations/${userId}/${randomUUID()}/${name}.jpg`;
  await env.storage.put(p, Buffer.from("jpeg"));
  return p;
}

// ------------------------------------------------------------------ identity

describe("who may call the API", () => {
  it("anonymous users are refused with 401 ACCOUNT_REQUIRED on contributor routes (local tokens)", async () => {
    const token = await anonymousUser();
    for (const r of [
      await wallet(req("GET", "/api/me/wallet", { token }), noCtx),
      await getMe(req("GET", "/api/me", { token }), noCtx),
      await createSession(req("POST", "/api/capture/sessions", { token, body: { bounty_id: DEMO.bountyId, lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5 } }), noCtx),
    ]) {
      expect(r.status).toBe(401);
      expect(await code(r)).toBe("ACCOUNT_REQUIRED");
    }
  });

  it("anonymous Supabase users are refused with 401 ACCOUNT_REQUIRED; email accounts pass", async () => {
    const a = await account();
    vi.stubEnv("LOCAL_BACKEND", "0");
    getUser.mockResolvedValueOnce({ data: { user: { id: a.id, is_anonymous: true, email: null } }, error: null });
    const r = await wallet(req("GET", "/api/me/wallet", { token: "supabase-jwt" }), noCtx);
    expect(r.status).toBe(401);
    expect(await code(r)).toBe("ACCOUNT_REQUIRED");
    getUser.mockResolvedValueOnce({ data: { user: { id: a.id, is_anonymous: false, email: a.email } }, error: null });
    expect((await wallet(req("GET", "/api/me/wallet", { token: "supabase-jwt" }), noCtx)).status).toBe(200);
  });

  it("suspended accounts get 403 ACCOUNT_SUSPENDED everywhere", async () => {
    const a = await account();
    const s = await adminPatch(req("PATCH", `/api/admin/users/${a.id}`, { token: admin, body: { suspended: true } }), idCtx(a.id));
    expect(s.status).toBe(200);
    for (const r of [await getMe(req("GET", "/api/me", { token: a.token }), noCtx), await wallet(req("GET", "/api/me/wallet", { token: a.token }), noCtx)]) {
      expect(r.status).toBe(403);
      expect(await code(r)).toBe("ACCOUNT_SUSPENDED");
    }
    await adminPatch(req("PATCH", `/api/admin/users/${a.id}`, { token: admin, body: { suspended: false } }), idCtx(a.id));
    expect((await getMe(req("GET", "/api/me", { token: a.token }), noCtx)).status).toBe(200);
  });

  it("dev sessions are real accounts dev+<id>@local", async () => {
    const r = await devSession(req("POST", "/api/dev/session", { body: { role: "contributor" } }), noCtx);
    const b = (await r.json()) as { user_id: string; access_token: string };
    const u = await env.db.query<{ email: string; is_anonymous: boolean }>("select email, is_anonymous from auth.users where id = $1", [b.user_id]);
    expect(u[0]).toEqual({ email: `dev+${b.user_id}@local`, is_anonymous: false });
    expect((await wallet(req("GET", "/api/me/wallet", { token: b.access_token }), noCtx)).status).toBe(200);
  });

  it("public open data needs no login", async () => {
    expect((await publicList(req("GET", "/api/public/datasets"), noCtx)).status).toBe(200);
    expect((await publicDataset(req("GET", "/api/public/datasets/street-flood-depth?format=json"), slugCtx("street-flood-depth"))).status).toBe(200);
  });
});

// ------------------------------------------------------------------ sign-up

describe("POST /api/auth/signup", () => {
  it("creates a confirmed account with display name, adult + license consent", async () => {
    const a = await account();
    const p = await env.db.query<{ display_name: string; is_adult: boolean; consent_license: boolean; is_researcher: boolean }>(
      "select display_name, is_adult, consent_license, is_researcher from public.profiles where id = $1",
      [a.id],
    );
    expect(p[0]).toEqual({ display_name: "Ada", is_adult: true, consent_license: true, is_researcher: false });
    const me = MeSchema.parse(await (await getMe(req("GET", "/api/me", { token: a.token }), noCtx)).json());
    expect(me).toMatchObject({ email: a.email, is_contributor: true, is_researcher: false, is_admin: false, suspended: false, balance_cents: 0 });
  });

  it("duplicate email (any case) → 409 EMAIL_TAKEN", async () => {
    const { email } = await signUp();
    const again = await signUp({ email: email.toUpperCase() });
    expect(again.r.status).toBe(409);
    expect(await code(again.r)).toBe("EMAIL_TAKEN");
  });

  it("requires 18+ and terms, and a real password", async () => {
    for (const body of [
      { email: "x@example.org", password: "long enough pw", display_name: "X", is_adult: false, accept_terms: true },
      { email: "x@example.org", password: "long enough pw", display_name: "X", is_adult: true, accept_terms: false },
      { email: "x@example.org", password: "short", display_name: "X", is_adult: true, accept_terms: true },
    ]) {
      const r = await signup(req("POST", "/api/auth/signup", { body, headers: { "x-forwarded-for": freshIp() } }), noCtx);
      expect(r.status).toBe(400);
    }
  });

  it("is rate-limited per IP: 5 per hour, then 429 RATE_LIMITED; another IP is unaffected", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 5; i++) expect((await signUp({ ip })).r.status).toBe(201);
    const sixth = await signUp({ ip });
    expect(sixth.r.status).toBe(429);
    const body = (await sixth.r.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toMatch(/try again later/i);
    expect((await signUp({ ip: "203.0.113.8" })).r.status).toBe(201);
  });
});

// ------------------------------------------------------------------ researcher

describe("researcher access", () => {
  const rp = { organization: "Georgia Tech Hydrology", purpose: "Street flood depth for model calibration", accept_terms: true };

  it("self-serve on/off; flags drive authorization", async () => {
    const a = await account();
    expect((await bountyList(req("GET", "/api/bounties", { token: a.token }), noCtx)).status).toBe(403);
    const on = await researcherOn(req("POST", "/api/me/researcher", { token: a.token, body: rp }), noCtx);
    expect(on.status).toBe(200);
    expect(MeSchema.parse(await on.json())).toMatchObject({ is_researcher: true, researcher_profile: { organization: rp.organization } });
    expect((await bountyList(req("GET", "/api/bounties", { token: a.token }), noCtx)).status).toBe(200);
    const off = await researcherOff(req("DELETE", "/api/me/researcher", { token: a.token }), noCtx);
    expect(MeSchema.parse(await off.json()).is_researcher).toBe(false);
    const denied = await bountyList(req("GET", "/api/bounties", { token: a.token }), noCtx);
    expect(denied.status).toBe(403);
    expect(await code(denied)).toBe("RESEARCHER_REQUIRED");
  });

  it("needs terms and a real purpose", async () => {
    const a = await account();
    expect((await researcherOn(req("POST", "/api/me/researcher", { token: a.token, body: { ...rp, accept_terms: false } }), noCtx)).status).toBe(400);
    expect((await researcherOn(req("POST", "/api/me/researcher", { token: a.token, body: { ...rp, purpose: "x" } }), noCtx)).status).toBe(400);
  });

  it("an admin revoke sticks (RESEARCHER_REVOKED) until an admin grants it again", async () => {
    const a = await account();
    await researcherOn(req("POST", "/api/me/researcher", { token: a.token, body: rp }), noCtx);
    const rev = await adminPatch(req("PATCH", `/api/admin/users/${a.id}`, { token: admin, body: { is_researcher: false } }), idCtx(a.id));
    expect(AdminUserSchema.parse(await rev.json()).is_researcher).toBe(false);
    const again = await researcherOn(req("POST", "/api/me/researcher", { token: a.token, body: rp }), noCtx);
    expect(again.status).toBe(403);
    expect(await code(again)).toBe("RESEARCHER_REVOKED");
    await adminPatch(req("PATCH", `/api/admin/users/${a.id}`, { token: admin, body: { is_researcher: true } }), idCtx(a.id));
    await researcherOff(req("DELETE", "/api/me/researcher", { token: a.token }), noCtx);
    expect((await researcherOn(req("POST", "/api/me/researcher", { token: a.token, body: rp }), noCtx)).status).toBe(200);
  });

  it("a researcher can't read another researcher's bounty submissions (API)", async () => {
    const a = await account();
    await researcherOn(req("POST", "/api/me/researcher", { token: a.token, body: rp }), noCtx);
    const c = await account();
    const sid = await insertSub(c.id, { status: "needs_review" }); // on the admin-owned demo bounty
    const r = await getSubmission(req("GET", `/api/submissions/${sid}`, { token: a.token }), idCtx(sid));
    expect(r.status).toBe(404);
    expect((await getSubmission(req("GET", `/api/submissions/${sid}`, { token: admin }), idCtx(sid))).status).toBe(200);
  });
});

// ------------------------------------------------------------------ admin

describe("admin users", () => {
  it("non-admins (incl. researchers) get 403 ADMIN_REQUIRED on every admin route", async () => {
    const a = await account();
    await researcherOn(req("POST", "/api/me/researcher", { token: a.token, body: { organization: "Org", purpose: "A good long purpose", accept_terms: true } }), noCtx);
    const victim = await account();
    for (const r of [
      await adminUsers(req("GET", "/api/admin/users", { token: a.token }), noCtx),
      await adminPatch(req("PATCH", `/api/admin/users/${a.id}`, { token: a.token, body: { is_admin: true } }), idCtx(a.id)),
      await adminReset(req("POST", `/api/admin/users/${victim.id}/reset-password`, { token: a.token }), idCtx(victim.id)),
    ]) {
      expect(r.status).toBe(403);
      expect(await code(r)).toBe("ADMIN_REQUIRED");
    }
    const flags = await env.db.query<{ is_admin: boolean }>("select is_admin from public.profiles where id = $1", [a.id]);
    expect(flags[0]?.is_admin).toBe(false);
  });

  it("lists and searches users (no anonymous users, no deleted-user placeholder)", async () => {
    const a = await account();
    await anonymousUser();
    const all = await adminUsers(req("GET", "/api/admin/users?limit=200", { token: admin }), noCtx);
    const users = ((await all.json()) as { users: unknown[] }).users.map((u) => AdminUserSchema.parse(u));
    expect(users.some((u) => u.id === DEMO.deletedUserId)).toBe(false);
    expect(users.every((u) => u.email !== null)).toBe(true);
    const found = await adminUsers(req("GET", `/api/admin/users?q=${encodeURIComponent(a.email.slice(0, 9))}`, { token: admin }), noCtx);
    expect(((await found.json()) as { users: { id: string }[] }).users.map((u) => u.id)).toEqual([a.id]);
    const pct = await adminUsers(req("GET", "/api/admin/users?q=%25", { token: admin }), noCtx); // "%" is literal
    expect(((await pct.json()) as { users: unknown[] }).users).toHaveLength(0);
  });

  it("an admin can't remove their own admin flag or suspend themselves; can promote others", async () => {
    for (const body of [{ is_admin: false }, { suspended: true }]) {
      const r = await adminPatch(req("PATCH", `/api/admin/users/${DEMO.researcherId}`, { token: admin, body }), idCtx(DEMO.researcherId));
      expect(r.status).toBe(409);
      expect(await code(r)).toBe("CANNOT_CHANGE_SELF");
    }
    const a = await account();
    const p = await adminPatch(req("PATCH", `/api/admin/users/${a.id}`, { token: admin, body: { is_admin: true, is_researcher: true } }), idCtx(a.id));
    expect(AdminUserSchema.parse(await p.json())).toMatchObject({ is_admin: true, is_researcher: true });
    expect((await adminUsers(req("GET", "/api/admin/users", { token: a.token }), noCtx)).status).toBe(200);
    const role = await env.db.query<{ role: string }>("select role::text as role from public.profiles where id = $1", [a.id]);
    expect(role[0]?.role).toBe("admin"); // legacy column kept in sync
  });

  it("unknown ids and the placeholder are 404", async () => {
    for (const id of [randomUUID(), DEMO.deletedUserId]) {
      expect((await adminPatch(req("PATCH", `/api/admin/users/${id}`, { token: admin, body: { suspended: true } }), idCtx(id))).status).toBe(404);
      expect((await adminReset(req("POST", `/api/admin/users/${id}/reset-password`, { token: admin }), idCtx(id))).status).toBe(404);
    }
  });

  it("reset-password returns a 16-char temporary password that signs in", async () => {
    const a = await account();
    const r = await adminReset(req("POST", `/api/admin/users/${a.id}/reset-password`, { token: admin }), idCtx(a.id));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const { temporary_password } = (await r.json()) as { temporary_password: string };
    expect(temporary_password).toMatch(/^[A-Za-z2-9]{16}$/);
    expect((await devLogin(req("POST", "/api/dev/login", { body: { email: a.email, password: a.password } }), noCtx)).status).toBe(400);
    expect((await devLogin(req("POST", "/api/dev/login", { body: { email: a.email, password: temporary_password } }), noCtx)).status).toBe(200);
  });
});

// ------------------------------------------------------------------ password

describe("POST /api/me/password", () => {
  function fakeAuth(valid: string): AccountAuth & { set: string[] } {
    const set: string[] = [];
    return {
      set,
      createUser: async () => ({ id: randomUUID() }),
      verifyPassword: async (_email, pw) => pw === valid,
      setPassword: async (_id, pw) => {
        set.push(pw);
      },
      deleteUser: async () => undefined,
      requestPasswordReset: async () => undefined,
      verifyRecovery: async () => null,
      revokeSessions: async () => undefined,
    };
  }

  it("verifies the current password (password grant) before setting the new one", async () => {
    const a = await account();
    const fake = fakeAuth("old password 1");
    setAccountAuthForTests(fake);
    const bad = await changePassword(req("POST", "/api/me/password", { token: a.token, body: { current_password: "nope", new_password: "new password 2" } }), noCtx);
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("INVALID_CREDENTIALS");
    expect(fake.set).toEqual([]);
    const ok = await changePassword(req("POST", "/api/me/password", { token: a.token, body: { current_password: "old password 1", new_password: "new password 2" } }), noCtx);
    expect(ok.status).toBe(200);
    expect(fake.set).toEqual(["new password 2"]);
  });

  it("end to end on the local auth: the new password signs in, the old one doesn't", async () => {
    const a = await account();
    const r = await changePassword(req("POST", "/api/me/password", { token: a.token, body: { current_password: a.password, new_password: "brand new secret" } }), noCtx);
    expect(r.status).toBe(200);
    expect((await devLogin(req("POST", "/api/dev/login", { body: { email: a.email, password: a.password } }), noCtx)).status).toBe(400);
    expect((await devLogin(req("POST", "/api/dev/login", { body: { email: a.email, password: "brand new secret" } }), noCtx)).status).toBe(200);
  });

  it("new password must be 8+ characters", async () => {
    const a = await account();
    const r = await changePassword(req("POST", "/api/me/password", { token: a.token, body: { current_password: a.password, new_password: "short" } }), noCtx);
    expect(r.status).toBe(400);
  });
});

// ------------------------------------------------------------------ data rights

describe("GET /api/me/export", () => {
  it("returns a JSON attachment with profile, sessions, submissions (+ checks, signed URLs), ledger", async () => {
    const a = await account();
    const p = await photo(a.id);
    const sid = await insertSub(a.id, { status: "accepted", media: [p] });
    await env.db.query("insert into public.ledger_entries (user_id, submission_id, amount_cents, kind) values ($1, $2, 250, 'payout')", [a.id, sid]);
    const other = await account();
    await insertSub(other.id, { status: "accepted" });
    const r = await exportMe(req("GET", "/api/me/export", { token: a.token }), noCtx);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="groundtruth-my-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = (await r.json()) as {
      account: { id: string; email: string };
      profile: { display_name: string };
      capture_sessions: unknown[];
      submissions: { id: string; checks: unknown; media_urls: string[] }[];
      ledger: { balance_cents: number; entries: unknown[] };
    };
    expect(body.account).toMatchObject({ id: a.id, email: a.email });
    expect(body.profile.display_name).toBe("Ada");
    expect(Array.isArray(body.capture_sessions)).toBe(true);
    expect(body.submissions.map((s) => s.id)).toEqual([sid]); // only mine
    expect(body.submissions[0]!.checks).toBeDefined();
    expect(body.submissions[0]!.media_urls[0]).toMatch(/\/api\/dev\/media\?path=/);
    expect(body.ledger.balance_cents).toBe(250);
  });
});

describe("DELETE /api/me", () => {
  it("requires the typed confirmation", async () => {
    const a = await account();
    expect((await deleteMe(req("DELETE", "/api/me", { token: a.token, body: { confirm: "delete" } }), noCtx)).status).toBe(400);
    expect((await getMe(req("GET", "/api/me", { token: a.token }), noCtx)).status).toBe(200);
  });

  it("deletes photos, ledger, sessions, profile, auth user; keeps publishable accepted rows de-identified in the open dataset", async () => {
    const a = await account();
    const keepPhoto = await photo(a.id);
    const dropPhoto = await photo(a.id);
    const keep = await insertSub(a.id, { status: "accepted", verifier: "model", confidence: 0.9, media: [keepPhoto] });
    const lowConf = await insertSub(a.id, { status: "accepted", verifier: "model", confidence: 0.6 });
    const rejected = await insertSub(a.id, { status: "rejected", media: [dropPhoto] });
    const mock = await insertSub(a.id, { status: "accepted", verifier: "mock", confidence: 0.99 });
    await env.db.query("insert into public.ledger_entries (user_id, submission_id, amount_cents, kind) values ($1, $2, 500, 'payout')", [a.id, keep]);
    const other = await account();
    const othersRow = await insertSub(other.id, { status: "accepted" });

    const pub = observationPseudonym(await publicDatasetSalt(env.db), "street-flood-depth", keep);
    const before = await publicDataset(req("GET", "/api/public/datasets/street-flood-depth?format=json"), slugCtx("street-flood-depth"));
    const beforeRows = ((await before.json()) as { rows: { observation_id: string }[] }).rows;
    expect(beforeRows.some((r) => r.observation_id === pub)).toBe(true);

    const r = await deleteMe(req("DELETE", "/api/me", { token: a.token, body: { confirm: "DELETE" } }), noCtx);
    expect(r.status).toBe(204);

    expect(await env.storage.exists(keepPhoto)).toBe(false);
    expect(await env.storage.exists(dropPhoto)).toBe(false);
    expect(await env.db.query("select 1 from public.profiles where id = $1", [a.id])).toHaveLength(0);
    expect(await env.db.query("select 1 from auth.users where id = $1", [a.id])).toHaveLength(0);
    expect(await env.db.query("select 1 from public.ledger_entries where user_id = $1", [a.id])).toHaveLength(0);
    expect(await env.db.query("select 1 from public.submissions where user_id = $1", [a.id])).toHaveLength(0);
    const kept = await env.db.query<{ user_id: string; media_purged_at: unknown; device: unknown }>(
      "select user_id, media_purged_at, device from public.submissions where id = $1",
      [keep],
    );
    expect(kept[0]).toMatchObject({ user_id: DEMO.deletedUserId, device: {} });
    expect(kept[0]!.media_purged_at).not.toBeNull();
    const gone = await env.db.query("select id from public.submissions where id = any($1::uuid[])", [[lowConf, rejected, mock]]);
    expect(gone).toHaveLength(0);
    expect(await env.db.query("select 1 from public.submissions where id = $1", [othersRow])).toHaveLength(1);

    const after = await publicDataset(req("GET", "/api/public/datasets/street-flood-depth?format=json"), slugCtx("street-flood-depth"));
    const afterRows = ((await after.json()) as { rows: { observation_id: string }[] }).rows;
    expect(afterRows.some((x) => x.observation_id === pub)).toBe(true);
    expect(JSON.stringify(afterRows)).not.toContain(a.id);

    // the token is dead
    expect((await getMe(req("GET", "/api/me", { token: a.token }), noCtx)).status).toBe(401);
  });

  it("never deletes another user's photos through foreign paths in the deleter's rows (account deletion + retention)", async () => {
    const victim = await account();
    const attacker = await account();
    const v1 = await photo(victim.id);
    const v2 = await photo(victim.id);
    // Rows referencing someone else's paths get rejected by the pipeline, but the rows exist.
    await insertSub(attacker.id, { status: "rejected", media: [v1] });
    await insertSub(attacker.id, { status: "rejected", daysAgo: 40, media: [v2] });
    await purgeRejectedMedia(env.db, env.storage, { days: 30 });
    expect(await env.storage.exists(v2)).toBe(true);
    expect((await deleteMe(req("DELETE", "/api/me", { token: attacker.token, body: { confirm: "DELETE" } }), noCtx)).status).toBe(204);
    expect(await env.storage.exists(v1)).toBe(true);
  });

  it("if deleting the auth user fails, a retry finishes the job", async () => {
    const a = await account();
    await insertSub(a.id, { status: "rejected" });
    let fail = true;
    const { LocalAccountAuth } = await import("@/lib/account/authAdmin");
    const local = new LocalAccountAuth();
    setAccountAuthForTests({
      createUser: (e, p) => local.createUser(e, p),
      verifyPassword: (e, p) => local.verifyPassword(e, p),
      setPassword: (i, p) => local.setPassword(i, p),
      deleteUser: async (id) => {
        if (fail) throw new Error("auth down");
        await local.deleteUser(id);
      },
      requestPasswordReset: (e, r) => local.requestPasswordReset(e, r),
      verifyRecovery: (p) => local.verifyRecovery(p),
      revokeSessions: () => local.revokeSessions(),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await deleteMe(req("DELETE", "/api/me", { token: a.token, body: { confirm: "DELETE" } }), noCtx)).status).toBe(500);
    spy.mockRestore();
    expect(await env.db.query("select 1 from public.submissions where user_id = $1", [a.id])).toHaveLength(0);
    fail = false;
    expect((await deleteMe(req("DELETE", "/api/me", { token: a.token, body: { confirm: "DELETE" } }), noCtx)).status).toBe(204);
    expect(await env.db.query("select 1 from auth.users where id = $1", [a.id])).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ retention

describe("rejected-photo retention", () => {
  it("deletes only >30-day rejected photos, marks them, and the API stops serving URLs", async () => {
    const a = await account();
    const oldP = await photo(a.id);
    const newP = await photo(a.id);
    const accP = await photo(a.id);
    const old = await insertSub(a.id, { status: "rejected", daysAgo: 31, media: [oldP] });
    const recent = await insertSub(a.id, { status: "rejected", daysAgo: 10, media: [newP] });
    const acceptedOld = await insertSub(a.id, { status: "accepted", daysAgo: 60, media: [accP] });

    const res = await purgeRejectedMedia(env.db, env.storage, { days: 30 });
    expect(res.submissions).toBeGreaterThanOrEqual(1);
    expect(await env.storage.exists(oldP)).toBe(false);
    expect(await env.storage.exists(newP)).toBe(true);
    expect(await env.storage.exists(accP)).toBe(true);
    const marks = await env.db.query<{ id: string; purged: boolean }>(
      "select id, media_purged_at is not null as purged from public.submissions where id = any($1::uuid[])",
      [[old, recent, acceptedOld]],
    );
    expect(Object.fromEntries(marks.map((m) => [m.id, m.purged]))).toEqual({ [old]: true, [recent]: false, [acceptedOld]: false });

    const view = (await (await getSubmission(req("GET", `/api/submissions/${old}`, { token: a.token }), idCtx(old))).json()) as {
      media_urls: string[];
      media_purged_at: string | null;
    };
    expect(view.media_purged_at).not.toBeNull();
    expect(view.media_urls).toEqual([""]);
    expect((await purgeRejectedMedia(env.db, env.storage, { days: 30 })).submissions).toBe(0); // idempotent
  });

  it("the cron route requires Bearer CRON_SECRET (GET for Vercel Cron, POST manual)", async () => {
    const secret = "s".repeat(32);
    expect((await cronGet(req("GET", "/api/cron/retention", { token: secret }), noCtx)).status).toBe(401); // unset
    vi.stubEnv("CRON_SECRET", secret);
    expect((await cronGet(req("GET", "/api/cron/retention"), noCtx)).status).toBe(401);
    expect((await cronGet(req("GET", "/api/cron/retention", { token: "wrong" }), noCtx)).status).toBe(401);
    expect((await cronGet(req("GET", "/api/cron/retention", { token: admin }), noCtx)).status).toBe(401); // user tokens don't work
    const ok = await cronGet(req("GET", "/api/cron/retention", { token: secret }), noCtx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, rejected_media: { submissions: expect.any(Number) } });
    expect((await cronPost(req("POST", "/api/cron/retention", { token: secret }), noCtx)).status).toBe(200);
  });
});

// ------------------------------------------------------------------ rate limits

describe("rate limits (429 RATE_LIMITED)", () => {
  async function exhaust(name: string, subject: string, count: number) {
    await env.db.query(
      `insert into public.rate_limits (key, window_start, count)
       values ($1, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), $2)
       on conflict (key, window_start) do update set count = excluded.count`,
      [`${name}:${subject}`, count],
    );
  }

  it("capture sessions: 30/hour per user", async () => {
    const a = await account();
    await exhaust("capture_session", a.id, 30);
    const r = await createSession(req("POST", "/api/capture/sessions", { token: a.token, body: { bounty_id: DEMO.bountyId, lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5 } }), noCtx);
    expect(r.status).toBe(429);
    expect(await code(r)).toBe("RATE_LIMITED");
    const b = await account(); // per user
    const ok = await createSession(req("POST", "/api/capture/sessions", { token: b.token, body: { bounty_id: DEMO.bountyId, lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5 } }), noCtx);
    expect(ok.status).toBe(201);
  });

  it("submissions: 20/hour per user", async () => {
    const a = await account();
    await exhaust("submission", a.id, 20);
    const at = new Date().toISOString();
    const r = await createSubmission(
      req("POST", "/api/submissions", {
        token: a.token,
        body: {
          session_id: randomUUID(), nonce: "n".repeat(16), media: [{ path: `observations/${a.id}/s/0.jpg`, captured_at: at }],
          lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5, captured_at: at,
          device: { model: "iPhone", os: "ios", os_version: "26", app_version: "1" },
          sensors: { tilt_deg: 0, rotation_rate: 0, steady: true },
          gate: { degraded: false, frame_checks: 2, consecutive_green: 2, last_hint: null },
        },
      }),
      noCtx,
    );
    expect(r.status).toBe(429);
  });

  it("protocol drafts (10/hour) and red-team runs (20/hour) per researcher", async () => {
    await exhaust("protocol_draft", DEMO.researcherId, 10);
    const d = await draftProtocol(req("POST", "/api/protocols/draft", { token: admin, body: { need: "Measure how deep the puddles on campus get after a storm" } }), noCtx);
    expect(d.status).toBe(429);
    await exhaust("redteam", DEMO.researcherId, 20);
    const rt = await redteamRun(req("POST", "/api/redteam/run", { token: admin, body: { bounty_id: DEMO.bountyId, attack_type: "ai_generated" } }), noCtx);
    expect(rt.status).toBe(429);
    await env.db.query("delete from public.rate_limits where key like any(array['protocol_draft:%', 'redteam:%'])");
  });
});
