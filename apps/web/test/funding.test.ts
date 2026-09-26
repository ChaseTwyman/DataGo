/**
 * Sponsor pool + platform pricing on PGlite: request → allocation engine (earmarks before the general
 * pool, pending when the pool can't cover the minimum), admin approvals/adjustments, authorization
 * (only admins move money; researchers request; contributors neither), budget enforcement on
 * capture sessions, price explanations, and the public transparency endpoint.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BountyDetailSchema,
  CoverageResponseSchema,
  DEMO,
  FundingOverviewSchema,
  NearbyResponseSchema,
  PricingPreviewResponseSchema,
  PublicFundingResponseSchema,
} from "@groundtruth/shared";
import { POST as devSession } from "@/app/api/dev/session/route";
import { POST as createBounty } from "@/app/api/bounties/route";
import { GET as bountyGet, PATCH as bountyPatch } from "@/app/api/bounties/[id]/route";
import { GET as coverage } from "@/app/api/bounties/[id]/coverage/route";
import { GET as nearby } from "@/app/api/bounties/nearby/route";
import { POST as createSession } from "@/app/api/capture/sessions/route";
import { POST as preview } from "@/app/api/pricing/preview/route";
import { GET as overview } from "@/app/api/admin/funding/route";
import { POST as runAllocation } from "@/app/api/admin/funding/run/route";
import { POST as createSponsor, GET as listSponsors } from "@/app/api/admin/sponsors/route";
import { PATCH as patchSponsor } from "@/app/api/admin/sponsors/[id]/route";
import { POST as contribute } from "@/app/api/admin/funding/contributions/route";
import { POST as reverse } from "@/app/api/admin/funding/contributions/[id]/reverse/route";
import { POST as setAllocation } from "@/app/api/admin/bounties/[id]/allocation/route";
import { GET as publicFunding } from "@/app/api/public/funding/route";
import { setContextFetch } from "@/lib/context/fetcher";
import { clearHazardCache } from "@/lib/hazards";
import { ensureDevUser } from "@/lib/db/repos/profiles";
import { devTokenFor } from "@/lib/auth";
import { FUNDING } from "@/lib/funding/allocation";
import { idCtx, req, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
let admin: string;
const noCtx = undefined as unknown;

beforeAll(async () => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  env = await setupTestEnv();
  setContextFetch(async () => Response.json({ features: [] }));
  const r = await devSession(req("POST", "/api/dev/session", { body: { role: "researcher" } }), noCtx);
  admin = ((await r.json()) as { access_token: string }).access_token;
}, 60_000);
afterAll(async () => {
  setContextFetch(null);
  vi.unstubAllEnvs();
  await env.close();
});
beforeEach(() => clearHazardCache());

async function user(role: "contributor" | "researcher"): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  await ensureDevUser(env.db, id, role);
  return { id, token: devTokenFor(id) };
}

let lngSeq = -100;
/** A fresh area far from every other test's (no demand/supply interaction). */
function area() {
  lngSeq -= 0.5;
  return { center_lat: 38.5, center_lng: lngSeq };
}

async function request(token: string, over: Record<string, unknown> = {}) {
  const now = Date.now();
  const r = await createBounty(
    req("POST", "/api/bounties", {
      token,
      body: {
        protocol_id: DEMO.protocolId,
        title: "Street depth request",
        ...area(),
        radius_m: 300,
        starts_at: new Date(now - 3600_000).toISOString(),
        ends_at: new Date(now + 86_400_000).toISOString(),
        event_started_at: new Date(now - 600_000).toISOString(),
        target_per_cell: 5,
        justification: "Calibrating the flood model",
        ...over,
      },
    }),
    noCtx,
  );
  return { status: r.status, body: (await r.json()) as { id: string; status?: string; allocation_cents?: number; funding_reason?: string | null; error?: { code: string } } };
}

async function sponsor(name: string): Promise<string> {
  const r = await createSponsor(req("POST", "/api/admin/sponsors", { token: admin, body: { name, url: "https://sponsor.example" } }), noCtx);
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

async function give(sponsorId: string, cents: number, earmark: Record<string, unknown> = {}) {
  const r = await contribute(req("POST", "/api/admin/funding/contributions", { token: admin, body: { sponsor_id: sponsorId, amount_cents: cents, ...earmark } }), noCtx);
  expect(r.status).toBe(201);
  return ((await r.json()) as { contribution: { id: string } }).contribution.id;
}

const detail = async (token: string, id: string) => {
  const r = await bountyGet(req("GET", `/api/bounties/${id}`, { token }), idCtx(id));
  return { status: r.status, body: r.status === 200 ? BountyDetailSchema.parse(await r.json()) : null };
};
const allocate = (id: string, cents: number, reason = "admin decision") =>
  setAllocation(req("POST", `/api/admin/bounties/${id}/allocation`, { token: admin, body: { allocation_cents: cents, reason } }), idCtx(id));
const session = (token: string, bountyId: string, lat: number, lng: number) =>
  createSession(req("POST", "/api/capture/sessions", { token, body: { bounty_id: bountyId, lat, lng, accuracy_m: 5 } }), noCtx);

describe("authorization", () => {
  it("contributors can't request data, preview prices, or touch admin funding", async () => {
    const c = await user("contributor");
    expect((await request(c.token)).status).toBe(403);
    const p = await preview(req("POST", "/api/pricing/preview", { token: c.token, body: {} }), noCtx);
    expect(p.status).toBe(403);
    for (const res of [
      await overview(req("GET", "/api/admin/funding", { token: c.token }), noCtx),
      await listSponsors(req("GET", "/api/admin/sponsors", { token: c.token }), noCtx),
      await createSponsor(req("POST", "/api/admin/sponsors", { token: c.token, body: { name: "Me" } }), noCtx),
      await runAllocation(req("POST", "/api/admin/funding/run", { token: c.token }), noCtx),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it("researchers can request data but can't manage sponsors, contributions or allocations", async () => {
    const r = await user("researcher");
    const created = await request(r.token);
    expect(created.status).toBe(201);
    const s = await sponsor("Authz sponsor");
    const forbidden = [
      await createSponsor(req("POST", "/api/admin/sponsors", { token: r.token, body: { name: "Mine" } }), noCtx),
      await patchSponsor(req("PATCH", `/api/admin/sponsors/${s}`, { token: r.token, body: { active: false } }), idCtx(s)),
      await contribute(req("POST", "/api/admin/funding/contributions", { token: r.token, body: { sponsor_id: s, amount_cents: 100 } }), noCtx),
      await setAllocation(req("POST", `/api/admin/bounties/${created.body.id}/allocation`, { token: r.token, body: { allocation_cents: 5000, reason: "please" } }), idCtx(created.body.id)),
      await runAllocation(req("POST", "/api/admin/funding/run", { token: r.token }), noCtx),
      await overview(req("GET", "/api/admin/funding", { token: r.token }), noCtx),
    ];
    for (const res of forbidden) expect(res.status).toBe(403);
    const unauth = await overview(req("GET", "/api/admin/funding"), noCtx);
    expect(unauth.status).toBe(401);
  });

  it("researchers can't set prices, priority, budget or status of their own request", async () => {
    const r = await user("researcher");
    const { body } = await request(r.token, { base_price_cents: 1, max_price_cents: 1_000_000, budget_cents: 9_999_999, priority: 5, status: "active" });
    const d = (await detail(r.token, body.id)).body!;
    expect(d.status).toBe("pending_funding"); // "status: active" in the body is ignored
    expect(d.budget_cents).toBe(0);
    expect(d.base_price_cents).toBe(200);
    expect(d.max_price_cents).toBe(1000);
    for (const patch of [{ budget_cents: 100_000 }, { base_price_cents: 5 }, { max_price_cents: 99_999 }, { priority: 5 }, { target_per_cell: 99 }, { sponsor_name: "Me Inc" }]) {
      const res = await bountyPatch(req("PATCH", `/api/bounties/${body.id}`, { token: r.token, body: patch }), idCtx(body.id));
      expect(res.status).toBe(403);
    }
    const act = await bountyPatch(req("PATCH", `/api/bounties/${body.id}`, { token: r.token, body: { status: "active" } }), idCtx(body.id));
    expect(act.status).toBe(409);
    expect(await act.json()).toMatchObject({ error: { code: "NOT_FUNDED" } });
  });
});

describe("allocation engine", () => {
  it("an empty pool leaves a request pending_funding with a reason; a contribution funds it automatically", async () => {
    const r = await user("researcher");
    const first = await request(r.token);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe("pending_funding");
    expect(first.body.funding_reason).toMatch(/minimum viable allocation/);
    // researcher sees the reason on the funding panel; contributors don't see the request at all
    const d = (await detail(r.token, first.body.id)).body!;
    expect(d.funding?.funding_reason).toMatch(/minimum viable/);
    expect(d.justification).toBe("Calibrating the flood model");
    const c = await user("contributor");
    expect((await detail(c.token, first.body.id)).status).toBe(404);

    const s = await sponsor("General fund sponsor");
    await give(s, 400_000); // the contribution route runs the allocation engine
    const after = (await detail(r.token, first.body.id)).body!;
    expect(after.status).toBe("active");
    expect(after.budget_cents).toBe(after.funding!.estimated_need_cents);
    expect(after.funding!.sources).toEqual([{ sponsor_name: "GroundTruth sponsor pool", earmark: "General pool", amount_cents: after.budget_cents }]);
    expect(after.sponsor_name).toBe("GroundTruth sponsor pool");
    // now contributors see it, but never the funding panel
    const seen = (await detail(c.token, first.body.id)).body!;
    expect(seen.funding).toBeNull();
  });

  it("draws matching earmarks before the general pool", async () => {
    const s = await sponsor("Flood insurer");
    const where = area();
    await give(s, 2_000, { protocol_slug: "street-flood-depth", region_center_lat: where.center_lat, region_center_lng: where.center_lng, region_radius_m: 5_000 });
    const elsewhere = await give(s, 5_000, { protocol_slug: "street-flood-depth", region_center_lat: 0, region_center_lng: 0, region_radius_m: 1_000 });
    const r = await user("researcher");
    const { body } = await request(r.token, where);
    expect(body.status).toBe("active");
    const d = (await detail(r.token, body.id)).body!;
    expect(d.funding!.sources[0]).toMatchObject({ sponsor_name: "Flood insurer", amount_cents: 2_000 });
    expect(d.funding!.sources[1]).toMatchObject({ earmark: "General pool", amount_cents: d.budget_cents - 2_000 });
    // the earmark for another region is untouched
    const o = FundingOverviewSchema.parse(await (await overview(req("GET", "/api/admin/funding", { token: admin }), noCtx)).json());
    expect(o.buckets.find((b) => b.contribution_id === elsewhere)?.available_cents).toBe(5_000);
    // a price explanation for contributors: earmarks with money left count as demand
    const cov = CoverageResponseSchema.parse(await (await coverage(req("GET", `/api/bounties/${body.id}/coverage`, { token: r.token }), idCtx(body.id))).json());
    expect(cov.cells[0]!.price_reasons).toContain("Few readings here");
  });

  it("an earmark for one request funds only that request, even past the researcher guardrail", async () => {
    const r = await user("researcher");
    const s = await sponsor("Specific sponsor");
    for (let i = 0; i < FUNDING.autoMaxLivePerResearcher; i++) expect((await request(r.token)).body.status).toBe("active");
    const waiting = await request(r.token);
    expect(waiting.body.status).toBe("pending_funding");
    expect(waiting.body.funding_reason).toMatch(/Waiting for an admin/);
    await give(s, 50_000, { bounty_id: waiting.body.id });
    const d = (await detail(r.token, waiting.body.id)).body!;
    expect(d.status).toBe("active");
    expect(d.funding!.sources).toEqual([{ sponsor_name: "Specific sponsor", earmark: "This request only", amount_cents: d.budget_cents }]);
    expect(d.sponsor_name).toBe("Specific sponsor");
  });

  it("admins approve pending requests and adjust allocations; never below what's paid or promised", async () => {
    const r = await user("researcher");
    for (let i = 0; i < FUNDING.autoMaxLivePerResearcher; i++) await request(r.token);
    const { body } = await request(r.token);
    expect(body.status).toBe("pending_funding");
    const ok = await allocate(body.id, 12_345, "Approved: storm season");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "active", allocation_cents: 12_345, funding_reason: null });
    const down = await allocate(body.id, 2_000, "Trim");
    expect(((await down.json()) as { allocation_cents: number }).allocation_cents).toBe(2_000);
    const huge = await allocate(body.id, 99_000_000, "Too much");
    expect(huge.status).toBe(409);
    expect(await huge.json()).toMatchObject({ error: { code: "POOL_INSUFFICIENT" } });
    // lock a quote, then try to cut below it
    const c = await user("contributor");
    const d = (await detail(r.token, body.id)).body!;
    const s = await session(c.token, body.id, d.center_lat, d.center_lng);
    expect(s.status).toBe(201);
    const cut = await allocate(body.id, 0, "Cancel");
    expect(cut.status).toBe(409);
    expect(await cut.json()).toMatchObject({ error: { code: "BELOW_COMMITTED" } });
  });

  it("closing a request returns its unspent allocation to the pool", async () => {
    const before = FundingOverviewSchema.parse(await (await overview(req("GET", "/api/admin/funding", { token: admin }), noCtx)).json()).totals;
    const r = await user("researcher");
    const { body } = await request(r.token);
    expect(body.status).toBe("active");
    const close = await bountyPatch(req("PATCH", `/api/bounties/${body.id}`, { token: r.token, body: { status: "closed" } }), idCtx(body.id));
    expect(close.status).toBe(200);
    const d = BountyDetailSchema.parse(await close.json());
    expect(d.status).toBe("closed");
    expect(d.budget_cents).toBe(0);
    const after = FundingOverviewSchema.parse(await (await overview(req("GET", "/api/admin/funding", { token: admin }), noCtx)).json()).totals;
    expect(after.available_cents).toBe(before.available_cents);
    expect(after.allocated_cents).toBe(before.allocated_cents);
  });

  it("reversals only take back unallocated money; sponsors can be deactivated, not deleted", async () => {
    const s = await sponsor("Typo sponsor");
    const where = area();
    const id = await give(s, 1_000, { region_center_lat: where.center_lat, region_center_lng: where.center_lng, region_radius_m: 2_000 });
    expect((await request((await user("researcher")).token, where)).body.status).toBe("active");
    // drawn first (earmark before general pool) → fully allocated → can't reverse
    const no = await reverse(req("POST", `/api/admin/funding/contributions/${id}/reverse`, { token: admin, body: { amount_cents: 1_000, note: "typo" } }), idCtx(id));
    expect(no.status).toBe(409);
    const other = await give(s, 700, { protocol_slug: "no-such-protocol" });
    const yes = await reverse(req("POST", `/api/admin/funding/contributions/${other}/reverse`, { token: admin, body: { amount_cents: 700, note: "typo" } }), idCtx(other));
    expect(yes.status).toBe(201);
    const off = await patchSponsor(req("PATCH", `/api/admin/sponsors/${s}`, { token: admin, body: { active: false } }), idCtx(s));
    expect(((await off.json()) as { active: boolean; contributed_cents: number }).active).toBe(false);
    const blocked = await contribute(req("POST", "/api/admin/funding/contributions", { token: admin, body: { sponsor_id: s, amount_cents: 5 } }), noCtx);
    expect(blocked.status).toBe(400);
  });
});

describe("pricing on the server", () => {
  it("POST /api/pricing/preview prices the draft and says whether it would be funded", async () => {
    const r = await user("researcher");
    const now = Date.now();
    const res = await preview(
      req("POST", "/api/pricing/preview", {
        token: r.token,
        body: {
          protocol_id: DEMO.protocolId,
          ...area(),
          radius_m: 300,
          target_per_cell: 5,
          starts_at: new Date(now).toISOString(),
          ends_at: new Date(now + 86_400_000).toISOString(),
          event_started_at: new Date(now - 600_000).toISOString(),
        },
      }),
      noCtx,
    );
    expect(res.status).toBe(200);
    const p = PricingPreviewResponseSchema.parse(await res.json());
    expect(p.cells.length).toBe(p.cells_total);
    expect(p.base_cents).toBe(200);
    expect(p.price_cents).toBeGreaterThanOrEqual(200);
    expect(p.price_cents).toBeLessThanOrEqual(1000);
    expect(p.price_reasons).toContain("Event is recent");
    expect(p.funding.would_fund).toBe(true);
    // factor weights never leave the server
    expect(JSON.stringify(p)).not.toMatch(/"factors"|"scarcity"|"urgency"/);
  });

  it("nearby carries price_reasons for the phone", async () => {
    const r = await user("researcher");
    const where = area();
    const { body } = await request(r.token, where);
    expect(body.status).toBe("active");
    const c = await user("contributor");
    const n = NearbyResponseSchema.parse(await (await nearby(req("GET", `/api/bounties/nearby?lat=${where.center_lat}&lng=${where.center_lng}&radius_km=5`, { token: c.token }), noCtx)).json());
    const b = n.bounties.find((x) => x.id === body.id)!;
    expect(b.price_reasons).toEqual(expect.arrayContaining(["Few readings here", "Event is recent"]));
    expect(b.budget_remaining_cents).toBeLessThanOrEqual(b.budget_remaining_cents);
  });

  it("sessions are refused once the allocation can't cover a new quote on top of locked ones", async () => {
    const r = await user("researcher");
    const where = area();
    const { body } = await request(r.token, where);
    // prices fall to the $2 floor when the allocation is tight; one worst-case quote = $2.40
    expect((await allocate(body.id, 340, "tight")).status).toBe(200);
    const c1 = await user("contributor");
    const c2 = await user("contributor");
    const s1 = await session(c1.token, body.id, where.center_lat, where.center_lng);
    expect(s1.status).toBe(201);
    expect(((await s1.json()) as { price_quote_cents: number }).price_quote_cents).toBe(200);
    const s2 = await session(c2.token, body.id, where.center_lat, where.center_lng);
    expect(s2.status).toBe(409);
    expect(await s2.json()).toMatchObject({ error: { code: "BUDGET_EXHAUSTED" } });
    // the same contributor re-opening replaces their own held quote instead of stacking holds
    const again = await session(c1.token, body.id, where.center_lat, where.center_lng);
    expect(again.status).toBe(201);
  });
});

describe("public transparency", () => {
  it("GET /api/public/funding needs no login and exposes only aggregates", async () => {
    const res = await publicFunding(req("GET", "/api/public/funding"), noCtx);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const p = PublicFundingResponseSchema.parse(JSON.parse(raw));
    expect(p.totals.contributed_cents).toBeGreaterThan(0);
    expect(p.totals.available_cents).toBe(p.totals.contributed_cents - p.totals.allocated_cents);
    expect(p.sponsors.some((s) => s.name === "General fund sponsor")).toBe(true);
    expect(p.sponsors.some((s) => s.name === "Typo sponsor")).toBe(false); // inactive
    expect(raw).not.toMatch(/@|created_by|justification|bounty_id/);
  });
});
