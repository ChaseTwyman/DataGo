import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO } from "@groundtruth/shared";
import { getAuth, userIdFromToken } from "@/lib/auth";
import { POST as devSession } from "@/app/api/dev/session/route";
import { PUT as devUpload } from "@/app/api/dev/upload/route";
import { GET as devMedia } from "@/app/api/dev/media/route";
import { GET as wallet } from "@/app/api/me/wallet/route";
import { GET as bountyList } from "@/app/api/bounties/route";
import { makeLocalToken } from "@/lib/storage/local";
import { newContributor, req, setupTestEnv, type TestEnv } from "./helpers";

// Stop the Supabase branch from trying a real network call when LOCAL_BACKEND is off.
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: new Error("invalid") }) } }),
}));

let env: TestEnv;
const noCtx = undefined as unknown;
beforeAll(async () => {
  env = await setupTestEnv();
}, 60_000);
afterAll(async () => env.close());
afterEach(() => vi.unstubAllEnvs());

describe("dev tokens", () => {
  it("are accepted with LOCAL_BACKEND=1", async () => {
    vi.stubEnv("LOCAL_BACKEND", "1");
    const u = await newContributor(env.db);
    expect(await userIdFromToken(u.token)).toBe(u.id);
    expect((await getAuth(req("GET", "/", { token: u.token })))?.role).toBe("contributor");
    const r = await wallet(req("GET", "/api/me/wallet", { token: u.token }), noCtx);
    expect(r.status).toBe(200);
  });

  it("are refused when LOCAL_BACKEND is off", async () => {
    vi.stubEnv("LOCAL_BACKEND", "0");
    const u = await newContributor(env.db);
    expect(await userIdFromToken(u.token)).toBeNull();
    expect(await getAuth(req("GET", "/", { token: u.token }))).toBeNull();
    const r = await wallet(req("GET", "/api/me/wallet", { token: u.token }), noCtx);
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("dev routes 404 unless LOCAL_BACKEND=1", async () => {
    vi.stubEnv("LOCAL_BACKEND", "0");
    const s = await devSession(req("POST", "/api/dev/session", { body: { role: "researcher" } }), noCtx);
    expect(s.status).toBe(404);
    const path = "observations/u/s/0.jpg";
    const up = await devUpload(req("PUT", `/api/dev/upload?path=${path}&token=${makeLocalToken("upload", path, 60)}`, { raw: Buffer.from("x") }), noCtx);
    expect(up.status).toBe(404);
    const md = await devMedia(req("GET", `/api/dev/media?path=${path}&token=${makeLocalToken("read", path, 60)}`), noCtx);
    expect(md.status).toBe(404);
  });

  it("missing or malformed bearer → 401 ApiError", async () => {
    vi.stubEnv("LOCAL_BACKEND", "1");
    for (const token of [undefined, "dev.not-a-uuid", "garbage"]) {
      const r = await wallet(req("GET", "/api/me/wallet", token ? { token } : {}), noCtx);
      expect(r.status).toBe(401);
    }
  });
});

describe("roles", () => {
  it("researcher dev session maps to the seeded admin; contributors cannot list bounties", async () => {
    vi.stubEnv("LOCAL_BACKEND", "1");
    const s = await devSession(req("POST", "/api/dev/session", { body: { role: "researcher" } }), noCtx);
    const body = (await s.json()) as { user_id: string; access_token: string; role: string };
    expect(body.user_id).toBe(DEMO.researcherId);
    expect(body.role).toBe("admin");
    expect((await bountyList(req("GET", "/api/bounties", { token: body.access_token }), noCtx)).status).toBe(200);
    const u = await newContributor(env.db);
    expect((await bountyList(req("GET", "/api/bounties", { token: u.token }), noCtx)).status).toBe(403);
  });

  it("signed upload URLs reject tampered paths and expired tokens", async () => {
    vi.stubEnv("LOCAL_BACKEND", "1");
    const good = "observations/u/s/0.jpg";
    const tok = makeLocalToken("upload", good, 60);
    const other = await devUpload(req("PUT", `/api/dev/upload?path=observations/u/s/1.jpg&token=${tok}`, { raw: Buffer.from("x") }), noCtx);
    expect(other.status).toBe(403);
    const expired = makeLocalToken("upload", good, -10);
    const r = await devUpload(req("PUT", `/api/dev/upload?path=${good}&token=${expired}`, { raw: Buffer.from("x") }), noCtx);
    expect(r.status).toBe(403);
    const readTok = makeLocalToken("read", good, 60); // read token cannot be used to upload
    expect((await devUpload(req("PUT", `/api/dev/upload?path=${good}&token=${readTok}`, { raw: Buffer.from("x") }), noCtx)).status).toBe(403);
  });
});
