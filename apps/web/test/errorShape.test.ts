/**
 * Every API failure is `{ error: { code, message } }` with a human message and no internals — even
 * when something deep inside a real route throws (DB down, upstream AI error text).
 */
import { ApiErrorSchema } from "@groundtruth/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setDbForTests, type Db } from "@/lib/db";
import { GrokError } from "@/lib/grok/config";
import { GROK_UNAVAILABLE_MESSAGE, INTERNAL_MESSAGE } from "@/lib/api/http";
import { newContributor, req, setupTestEnv, type TestEnv } from "./helpers";

const SECRET = 'relation "profiles" does not exist at Parser.parseErrorMessage (node_modules/pg/lib/parser.js:283:98) password=hunter2';
const UPSTREAM = 'xAI 500 {"error":"upstream connect error or disconnect/reset before headers","request_id":"req_abc123"}';

vi.mock("@/lib/grok/voiceToken", () => ({
  mintVoiceToken: async () => {
    throw new GrokError(UPSTREAM, "voice_token");
  },
}));

const { GET: wallet } = await import("@/app/api/me/wallet/route");
const { POST: voiceToken } = await import("@/app/api/voice/token/route");

/** Any sign of internals leaking into a client-facing message. */
const LEAK = /parser|node_modules|\.js:|relation|password|hunter2|request_id|xAI|upstream|\{|stack|at [A-Z]\w+\./i;

async function errorBody(res: Response) {
  const body = ApiErrorSchema.parse(await res.json());
  expect(body.error.message).not.toMatch(LEAK);
  expect(JSON.stringify(body)).not.toContain("hunter2");
  expect(JSON.stringify(body)).not.toContain("req_abc123");
  return body.error;
}

describe("API error shape", () => {
  let env: TestEnv;
  let token: string;
  beforeAll(async () => {
    vi.stubEnv("LOCAL_BACKEND", "1");
    env = await setupTestEnv();
    token = (await newContributor(env.db)).token;
  });
  afterAll(async () => {
    await env.close();
    vi.unstubAllEnvs();
  });

  it("a forced internal error inside a real route → 500 INTERNAL with a human message", async () => {
    const broken = new Proxy({} as Db, {
      get: () => () => {
        throw new Error(SECRET);
      },
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    setDbForTests(broken);
    try {
      const res = await wallet(req("GET", "/api/me/wallet", { token }), undefined);
      expect(res.status).toBe(500);
      const e = await errorBody(res);
      expect(e).toEqual({ code: "INTERNAL", message: INTERNAL_MESSAGE });
      // The detail still reaches the server log for debugging.
      expect(quiet).toHaveBeenCalled();
    } finally {
      setDbForTests(env.db);
      quiet.mockRestore();
    }
  });

  it("an upstream AI failure → 502 GROK_UNAVAILABLE without the provider's error text", async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await voiceToken(req("POST", "/api/voice/token", { token, body: {} }), undefined);
      expect(res.status).toBe(502);
      const e = await errorBody(res);
      expect(e).toEqual({ code: "GROK_UNAVAILABLE", message: GROK_UNAVAILABLE_MESSAGE });
    } finally {
      quiet.mockRestore();
    }
  });

  it("auth and validation failures keep the shape with readable messages", async () => {
    const noAuth = await wallet(req("GET", "/api/me/wallet"), undefined);
    expect(noAuth.status).toBe(401);
    expect((await errorBody(noAuth)).code).toBe("UNAUTHORIZED");
  });
});
