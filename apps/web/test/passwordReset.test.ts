/**
 * Forgot password via emailed code (POST /api/auth/password-reset/{request,confirm}).
 * Route logic runs against a fake AccountAuth; the real LocalAccountAuth (LOCAL_BACKEND dev mode)
 * and the SupabaseAccountAuth HTTP calls (fetch stubbed) are covered separately.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordResetConfirmResponseSchema } from "@groundtruth/shared";
import { POST as confirmReset } from "@/app/api/auth/password-reset/confirm/route";
import { POST as requestReset } from "@/app/api/auth/password-reset/request/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as devLogin } from "@/app/api/dev/login/route";
import {
  LocalAccountAuth,
  RecoveryRateLimitedError,
  setAccountAuthForTests,
  SupabaseAccountAuth,
  type AccountAuth,
  type RecoveredUser,
  type RecoveryProof,
} from "@/lib/account/authAdmin";
import { captureBackground, drainBackground } from "@/lib/background";
import { req, setupTestEnv, type TestEnv } from "./helpers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    throw new Error("password reset must not use the shared service-role client");
  },
}));

let env: TestEnv;
const noCtx = undefined as unknown;

beforeAll(async () => {
  env = await setupTestEnv();
}, 60_000);
afterAll(async () => env.close());
beforeEach(() => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  captureBackground();
});
afterEach(async () => {
  await drainBackground();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccountAuthForTests(null);
});

let ipSeq = 0;
const freshIp = () => `10.7.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const freshEmail = () => `r${randomUUID().slice(0, 8)}@example.org`;
const ipHeaders = (ip: string) => ({ "x-forwarded-for": `${ip}, 10.9.9.9` });

const request = (email: string, ip = freshIp()) =>
  requestReset(req("POST", "/api/auth/password-reset/request", { body: { email }, headers: ipHeaders(ip) }), noCtx);
const confirm = (body: Record<string, unknown>, ip = freshIp()) =>
  confirmReset(req("POST", "/api/auth/password-reset/confirm", { body, headers: ipHeaders(ip) }), noCtx);
const errCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

interface Fake extends AccountAuth {
  requested: string[];
  set: { id: string; pw: string }[];
  revoked: RecoveredUser[];
  proofs: RecoveryProof[];
}

/** Knows one account; its valid code is 246810 and its link token is "tokenhash-good". */
function fake(known: { id: string; email: string }): Fake {
  const f: Fake = {
    requested: [],
    set: [],
    revoked: [],
    proofs: [],
    createUser: async () => ({ id: randomUUID() }),
    verifyPassword: async () => false,
    setPassword: async (id, pw) => {
      f.set.push({ id, pw });
    },
    deleteUser: async () => undefined,
    requestPasswordReset: async (email) => {
      f.requested.push(email);
    },
    verifyRecovery: async (p) => {
      f.proofs.push(p);
      const ok = "tokenHash" in p ? p.tokenHash === "tokenhash-good" : p.email === known.email && p.code === "246810";
      return ok ? { id: known.id, email: known.email, accessToken: "recovery-jwt" } : null;
    },
    revokeSessions: async (u) => {
      f.revoked.push(u);
    },
  };
  return f;
}

async function signUp(email: string, password: string): Promise<string> {
  const r = await signup(
    req("POST", "/api/auth/signup", {
      body: { email, password, display_name: "Ada", is_adult: true, accept_terms: true },
      headers: ipHeaders(freshIp()),
    }),
    noCtx,
  );
  expect(r.status).toBe(201);
  return ((await r.json()) as { user_id: string }).user_id;
}

const canSignIn = async (email: string, password: string) =>
  (await devLogin(req("POST", "/api/dev/login", { body: { email, password } }), noCtx)).status === 200;

// ------------------------------------------------------------------ request

describe("POST /api/auth/password-reset/request", () => {
  it("answers 202 with an identical body for an existing and a non-existing email", async () => {
    const email = freshEmail();
    await signUp(email, "old password 1");
    const f = fake({ id: randomUUID(), email });
    setAccountAuthForTests(f);
    const a = await request(email);
    const b = await request(freshEmail());
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const [ta, tb] = [await a.text(), await b.text()];
    expect(ta).toBe(tb);
    expect(JSON.parse(ta)).toEqual({ ok: true });
    expect(a.headers.get("cache-control")).toBe("no-store");
    await drainBackground();
    // The route never looks the account up itself; the provider decides whether to send.
    expect(f.requested).toHaveLength(2);
  });

  it("the email is sent after the response, and a provider failure is logged without the address", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fake({ id: randomUUID(), email: "x@example.org" });
    f.requestPasswordReset = async () => {
      await gate;
      throw new Error("smtp 550");
    };
    setAccountAuthForTests(f);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const email = freshEmail();
    const r = await request(email); // resolves while the send is still blocked
    expect(r.status).toBe(202);
    release();
    await drainBackground();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).toContain("smtp 550");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(email);
  });

  it("is rate-limited per email (any IP) and per IP (any email)", async () => {
    setAccountAuthForTests(fake({ id: randomUUID(), email: "x@example.org" }));
    const email = freshEmail();
    for (let i = 0; i < 5; i++) expect((await request(email)).status).toBe(202);
    const limited = await request(email);
    expect(limited.status).toBe(429);
    expect(await errCode(limited)).toBe("RATE_LIMITED");
    // Case/whitespace variants are the same address.
    expect((await request(`  ${email.toUpperCase()} `)).status).toBe(429);

    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await request(freshEmail(), ip)).status).toBe(202);
    expect((await request(freshEmail(), ip)).status).toBe(429);
  });

  it("rejects a malformed email with a validation error (says nothing about accounts)", async () => {
    const r = await request("not-an-email");
    expect(r.status).toBe(400);
    expect(await errCode(r)).toBe("VALIDATION_FAILED");
  });
});

// ------------------------------------------------------------------ confirm

describe("POST /api/auth/password-reset/confirm", () => {
  it("a right code sets the new password, revokes every session, and returns the email", async () => {
    const user = { id: randomUUID(), email: freshEmail() };
    const f = fake(user);
    setAccountAuthForTests(f);
    const r = await confirm({ email: user.email, code: "246 810", new_password: "brand new secret" });
    expect(r.status).toBe(200);
    expect(PasswordResetConfirmResponseSchema.parse(await r.json())).toEqual({ ok: true, email: user.email, sessions_revoked: true });
    expect(f.proofs).toEqual([{ email: user.email, code: "246810" }]);
    expect(f.set).toEqual([{ id: user.id, pw: "brand new secret" }]);
    expect(f.revoked).toEqual([{ id: user.id, email: user.email, accessToken: "recovery-jwt" }]);
  });

  it("the link's token_hash works without an email", async () => {
    const user = { id: randomUUID(), email: freshEmail() };
    const f = fake(user);
    setAccountAuthForTests(f);
    const r = await confirm({ token_hash: "tokenhash-good", new_password: "brand new secret" });
    expect(r.status).toBe(200);
    expect(f.proofs).toEqual([{ tokenHash: "tokenhash-good" }]);
    expect(f.set).toHaveLength(1);
    expect(f.revoked).toHaveLength(1);
    const bad = await confirm({ token_hash: "tokenhash-bad", new_password: "brand new secret" });
    expect(bad.status).toBe(400);
    expect(await errCode(bad)).toBe("RESET_CODE_INVALID");
  });

  it("a wrong or expired code → 400 RESET_CODE_INVALID and nothing changes", async () => {
    const user = { id: randomUUID(), email: freshEmail() };
    const f = fake(user);
    setAccountAuthForTests(f);
    const r = await confirm({ email: user.email, code: "111111", new_password: "brand new secret" });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RESET_CODE_INVALID");
    expect(body.error.message).toMatch(/wrong or has expired/);
    expect(f.set).toEqual([]);
    expect(f.revoked).toEqual([]);
  });

  it("validates the new password (8+) and the code format before touching the auth server", async () => {
    const user = { id: randomUUID(), email: freshEmail() };
    const f = fake(user);
    setAccountAuthForTests(f);
    expect((await confirm({ email: user.email, code: "246810", new_password: "short" })).status).toBe(400);
    expect((await confirm({ email: user.email, code: "24681", new_password: "long enough" })).status).toBe(400);
    expect(f.proofs).toEqual([]);
  });

  it("brute force: 10 guesses per email per hour (from any IP), then even the right code is refused", async () => {
    const user = { id: randomUUID(), email: freshEmail() };
    const f = fake(user);
    setAccountAuthForTests(f);
    for (let i = 0; i < 10; i++) {
      const r = await confirm({ email: user.email, code: String(100000 + i), new_password: "brand new secret" });
      expect(r.status).toBe(400);
    }
    const limited = await confirm({ email: user.email, code: "246810", new_password: "brand new secret" });
    expect(limited.status).toBe(429);
    expect(await errCode(limited)).toBe("RATE_LIMITED");
    expect(f.set).toEqual([]);
  });

  it("brute force across emails: 30 attempts per IP per hour", async () => {
    setAccountAuthForTests(fake({ id: randomUUID(), email: "x@example.org" }));
    const ip = freshIp();
    for (let i = 0; i < 30; i++) expect((await confirm({ email: freshEmail(), code: "111111", new_password: "long enough" }, ip)).status).toBe(400);
    expect((await confirm({ email: freshEmail(), code: "111111", new_password: "long enough" }, ip)).status).toBe(429);
  });

  it("an auth-server throttle maps to RATE_LIMITED, not a 500", async () => {
    const f = fake({ id: randomUUID(), email: "x@example.org" });
    f.verifyRecovery = async () => {
      throw new RecoveryRateLimitedError();
    };
    setAccountAuthForTests(f);
    const r = await confirm({ email: freshEmail(), code: "246810", new_password: "long enough" });
    expect(r.status).toBe(429);
    expect(await errCode(r)).toBe("RATE_LIMITED");
  });

  it("if revoking sessions keeps failing: password still changed, logged, and reported as sessions_revoked=false", async () => {
    const user = { id: randomUUID(), email: freshEmail() };
    const f = fake(user);
    let tries = 0;
    f.revokeSessions = async () => {
      tries++;
      throw new Error("logout 500");
    };
    setAccountAuthForTests(f);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await confirm({ email: user.email, code: "246810", new_password: "brand new secret" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { sessions_revoked: boolean }).sessions_revoked).toBe(false);
    expect(f.set).toHaveLength(1);
    expect(tries).toBe(2);
    expect(JSON.stringify(warn.mock.calls)).toContain("logout 500");
  });

  it("a transient revoke failure is retried once", async () => {
    const user = { id: randomUUID(), email: freshEmail() };
    const f = fake(user);
    let tries = 0;
    f.revokeSessions = async () => {
      if (++tries === 1) throw new Error("blip");
    };
    setAccountAuthForTests(f);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await confirm({ email: user.email, code: "246810", new_password: "brand new secret" });
    expect(((await r.json()) as { sessions_revoked: boolean }).sessions_revoked).toBe(true);
    expect(tries).toBe(2);
  });

  it("an auth-server throttle on the link path isn't worded as 'for this address'", async () => {
    const f = fake({ id: randomUUID(), email: "x@example.org" });
    f.verifyRecovery = async () => {
      throw new RecoveryRateLimitedError();
    };
    setAccountAuthForTests(f);
    const r = await confirm({ token_hash: "tokenhash-good", new_password: "long enough" });
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: { message: string } }).error.message).not.toMatch(/address/);
  });
});

// ------------------------------------------------------------------ LOCAL_BACKEND end to end

describe("LOCAL_BACKEND dev mode (real LocalAccountAuth)", () => {
  const codeFrom = (spy: { mock: { calls: unknown[][] } }) => {
    const line = spy.mock.calls.map((c) => String(c[0])).find((s) => s.includes("[password-reset]"));
    const m = line ? /code for \S+ is (\d{6}) \(link: \S*token_hash=([0-9a-f]+)/.exec(line) : null;
    return m ? { code: m[1]!, tokenHash: m[2]! } : null;
  };

  it("request prints the code to the dev console; confirm resets the password once", async () => {
    const email = freshEmail();
    await signUp(email, "old password 1");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await request(email.toUpperCase())).status).toBe(202);
    await drainBackground();
    const sent = codeFrom(info);
    expect(sent).not.toBeNull();

    const wrong = await confirm({ email, code: sent!.code === "000000" ? "000001" : "000000", new_password: "brand new secret" });
    expect(await errCode(wrong)).toBe("RESET_CODE_INVALID");
    const ok = await confirm({ email, code: sent!.code, new_password: "brand new secret" });
    expect(ok.status).toBe(200);
    expect(await canSignIn(email, "brand new secret")).toBe(true);
    expect(await canSignIn(email, "old password 1")).toBe(false);
    // One-time: the same code (and its link) can't be replayed.
    expect(await errCode(await confirm({ email, code: sent!.code, new_password: "another secret 3" }))).toBe("RESET_CODE_INVALID");
    expect(await errCode(await confirm({ token_hash: sent!.tokenHash, new_password: "another secret 3" }))).toBe("RESET_CODE_INVALID");
  });

  it("the printed link's token_hash resets without the email", async () => {
    const email = freshEmail();
    await signUp(email, "old password 1");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await request(email);
    await drainBackground();
    const sent = codeFrom(info)!;
    const r = await confirm({ token_hash: sent.tokenHash, new_password: "link secret 42" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { email: string }).email).toBe(email);
    expect(await canSignIn(email, "link secret 42")).toBe(true);
  });

  it("an unknown email prints nothing and creates no code", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await request(freshEmail())).status).toBe(202);
    await drainBackground();
    expect(codeFrom(info)).toBeNull();
  });

  it("a newer request replaces the older code", async () => {
    const email = freshEmail();
    await signUp(email, "old password 1");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await request(email);
    await drainBackground();
    const first = codeFrom(info)!;
    info.mockClear();
    await request(email);
    await drainBackground();
    const second = codeFrom(info)!;
    if (first.code !== second.code) {
      expect(await errCode(await confirm({ email, code: first.code, new_password: "brand new secret" }))).toBe("RESET_CODE_INVALID");
    }
    expect((await confirm({ email, code: second.code, new_password: "brand new secret" })).status).toBe(200);
  });

  it("never prints the code when NODE_ENV=production", async () => {
    const email = freshEmail();
    await signUp(email, "old password 1");
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await new LocalAccountAuth().requestPasswordReset(email, undefined);
    expect([...info.mock.calls, ...log.mock.calls].flat().join(" ")).not.toMatch(/\b\d{6}\b/);
  });
});

// ------------------------------------------------------------------ Supabase adapter (HTTP)

describe("SupabaseAccountAuth recovery calls", () => {
  type Sent = { url: string; init: RequestInit };
  function stubFetch(responder: (url: string) => Response): Sent[] {
    const sent: Sent[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return responder(url);
    });
    return sent;
  }
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  it("request → /auth/v1/recover with redirect_to from NEXT_PUBLIC_SITE_URL (never the Host header)", async () => {
    vi.stubEnv("LOCAL_BACKEND", "0");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://groundtruth.example/");
    const sent = stubFetch(() => Response.json({}));
    setAccountAuthForTests(new SupabaseAccountAuth());
    const r = await requestReset(
      req("POST", "/api/auth/password-reset/request", { body: { email: "Sam@Example.org" }, headers: { ...ipHeaders(freshIp()), host: "evil.example" } }),
      noCtx,
    );
    expect(r.status).toBe(202);
    await drainBackground();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`https://proj.supabase.co/auth/v1/recover?redirect_to=${encodeURIComponent("https://groundtruth.example/reset-password")}`);
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ email: "sam@example.org" });
    expect((sent[0]!.init.headers as Record<string, string>).apikey).toBe("anon-key");
  });

  it("verify: code and token_hash bodies; 4xx → null; 429 → RecoveryRateLimitedError; 200 → user + token", async () => {
    const auth = new SupabaseAccountAuth();
    let status = 403;
    const sent = stubFetch(() =>
      status === 200
        ? Response.json({ access_token: "at", user: { id: "u1", email: "sam@example.org" } })
        : Response.json({ code: "otp_expired" }, { status }),
    );
    expect(await auth.verifyRecovery({ email: "sam@example.org", code: "123456" })).toBeNull();
    expect(sent[0]!.url).toBe("https://proj.supabase.co/auth/v1/verify");
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ type: "recovery", email: "sam@example.org", token: "123456" });
    status = 429;
    await expect(auth.verifyRecovery({ tokenHash: "th" })).rejects.toBeInstanceOf(RecoveryRateLimitedError);
    expect(JSON.parse(String(sent[1]!.init.body))).toEqual({ type: "recovery", token_hash: "th" });
    status = 200;
    expect(await auth.verifyRecovery({ tokenHash: "th" })).toEqual({ id: "u1", email: "sam@example.org", accessToken: "at" });
    status = 500;
    await expect(auth.verifyRecovery({ tokenHash: "th" })).rejects.toThrow(/verify failed: 500/);
  });

  it("revokeSessions → global logout with the recovery session's token", async () => {
    const sent = stubFetch(() => new Response(null, { status: 204 }));
    await new SupabaseAccountAuth().revokeSessions({ id: "u1", email: null, accessToken: "at" });
    expect(sent[0]!.url).toBe("https://proj.supabase.co/auth/v1/logout?scope=global");
    expect((sent[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer at");
    await expect(new SupabaseAccountAuth().revokeSessions({ id: "u1", email: null, accessToken: null })).rejects.toThrow();
  });
});
