import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO, pendingChecks } from "@groundtruth/shared";
import { getBounty, acceptedByCell, listBountiesFor, spendBudget } from "@/lib/db/repos/bounties";
import { getProtocol, listProtocols } from "@/lib/db/repos/protocols";
import { getProfile, setTrust } from "@/lib/db/repos/profiles";
import { insertSubmission, getSubmission, finalizeSubmission, priorHashes, countUserCellSince, previousUserSubmission } from "@/lib/db/repos/submissions";
import { insertLedger, wallet } from "@/lib/db/repos/ledger";
import { newContributor, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await setupTestEnv();
}, 60_000);
afterAll(async () => env.close());

describe("repos on PGlite (real migrations)", () => {
  it("reads the seeded bounty and protocol", async () => {
    const b = await getBounty(env.db, DEMO.bountyId);
    expect(b?.status).toBe("active");
    expect(b?.cells.length).toBeGreaterThan(5);
    expect(typeof b?.starts_at).toBe("string");
    const p = await getProtocol(env.db, DEMO.protocolId);
    expect(p?.definition.slug).toBe("street-flood-depth");
    const list = await listProtocols(env.db, DEMO.researcherId, true);
    expect(list.map((x) => x.slug)).toContain("street-flood-depth");
    const mine = await listBountiesFor(env.db, DEMO.researcherId, false);
    expect(mine[0]).toMatchObject({ id: DEMO.bountyId, protocol_slug: "street-flood-depth", accepted: 0 });
  });

  it("round-trips a submission with jsonb/arrays/timestamps", async () => {
    const u = await newContributor(env.db);
    const b = (await getBounty(env.db, DEMO.bountyId))!;
    const cell = b.cells[0]!;
    const at = new Date().toISOString();
    const id = await insertSubmission(env.db, {
      session_id: null,
      bounty_id: DEMO.bountyId,
      user_id: u.id,
      media: [{ path: `observations/${u.id}/s/0.jpg`, captured_at: at }],
      lat: DEMO.lat,
      lng: DEMO.lng,
      accuracy_m: 5,
      h3_cell: cell,
      captured_at: at,
      device: {},
      sensors: {},
      gate: {},
      field_notes: { water_state: "still" },
      checks: pendingChecks(),
    });
    await finalizeSubmission(env.db, id, {
      status: "accepted",
      checks: pendingChecks(),
      reason_codes: ["DEMO_WAIVER"],
      confidence: 0.9,
      protocol_score: 0.9,
      authenticity_score: 0.9,
      extracted: { depth_cm: 12 },
      phashes: ["00ff00ff00ff00ff"],
      payout_cents: 500,
      retryable: false,
      verifier: "model",
    });
    const s = (await getSubmission(env.db, id))!;
    expect(s.status).toBe("accepted");
    expect(s.verifier).toBe("model");
    expect(s.checks).toHaveLength(8);
    expect(s.reason_codes).toEqual(["DEMO_WAIVER"]);
    expect(s.extracted).toEqual({ depth_cm: 12 });
    expect(s.captured_at).toBe(at);
    expect((await acceptedByCell(env.db, DEMO.bountyId)).get(cell)).toBe(1);
    expect((await priorHashes(env.db, null)).map((r) => r.id)).toContain(id);
    expect(await priorHashes(env.db, id)).not.toContainEqual(expect.objectContaining({ id }));
    expect(await countUserCellSince(env.db, u.id, cell, new Date(Date.now() - 3600_000).toISOString(), null)).toBe(1);
    expect((await previousUserSubmission(env.db, u.id, new Date().toISOString(), null))?.lat).toBe(DEMO.lat);

    await insertLedger(env.db, { user_id: u.id, submission_id: id, amount_cents: 500, kind: "payout" });
    const w = await wallet(env.db, u.id);
    expect(w.balance_cents).toBe(500);
    expect(w.entries[0]).toMatchObject({ amount_cents: 500, kind: "payout", bounty_title: DEMO.title });
  });

  it("budget spend and trust updates", async () => {
    expect(await spendBudget(env.db, DEMO.bountyId, 100)).toBe(true);
    expect(await spendBudget(env.db, DEMO.bountyId, DEMO.budgetCents)).toBe(false);
    const u = await newContributor(env.db);
    await setTrust(env.db, u.id, 0.52);
    expect((await getProfile(env.db, u.id))?.trust_score).toBe(0.52);
  });
});
