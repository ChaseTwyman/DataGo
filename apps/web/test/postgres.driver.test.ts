/**
 * postgres.js driver regression: jsonb params were double-encoded (stored as jsonb strings) on real
 * Postgres while PGlite tests passed. The live test runs only when PG_LIVE_TEST_URL is set
 * (e.g. the Supabase DATABASE_URL); it uses a temp table and writes nothing persistent.
 */
import { describe, expect, it } from "vitest";
import { jsonParamSerializer, openPostgres } from "@/lib/db/postgres";
import { json } from "@/lib/db/types";

describe("jsonParamSerializer", () => {
  it("passes pre-stringified JSON through unchanged", () => {
    expect(jsonParamSerializer('[{"a":1}]')).toBe('[{"a":1}]');
  });
  it("stringifies raw values", () => {
    expect(jsonParamSerializer({ a: 1 })).toBe('{"a":1}');
  });
});

const live = process.env.PG_LIVE_TEST_URL;

describe.skipIf(!live)("postgres driver against a real server", () => {
  it("stores json() params as arrays/objects, not strings", async () => {
    const { db, close } = openPostgres(live!);
    try {
      const rows = await db.tx(async (t) => {
        await t.query("create temp table jt (j jsonb) on commit drop");
        await t.query("insert into jt (j) values ($1)", [json([{ a: 1 }])]);
        await t.query("insert into jt (j) values ($1::jsonb)", [json({ b: 2 })]);
        return t.query<{ t: string }>("select jsonb_typeof(j) as t from jt");
      });
      expect(rows.map((r) => r.t)).toEqual(["array", "object"]);
    } finally {
      await close();
    }
  });
});
