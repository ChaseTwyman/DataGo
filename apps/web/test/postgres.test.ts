import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "@/lib/db/postgres";

describe("normalizeDatabaseUrl", () => {
  it("strips Prisma-only params and requires SSL for hosted Supabase", () => {
    const r = normalizeDatabaseUrl("postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1");
    expect(r.url).toBe("postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres");
    expect(r.ssl).toBe("require");
  });
  it("no SSL for localhost unless asked; sslmode=disable honoured", () => {
    expect(normalizeDatabaseUrl("postgres://u:p@localhost:54322/postgres").ssl).toBe(false);
    expect(normalizeDatabaseUrl("postgres://u:p@localhost:54322/postgres?sslmode=require").ssl).toBe("require");
    expect(normalizeDatabaseUrl("postgres://u:p@db.example.com/postgres?sslmode=disable").ssl).toBe(false);
  });
});
