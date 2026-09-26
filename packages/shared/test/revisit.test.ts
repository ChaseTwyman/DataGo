import { describe, expect, it } from "vitest";
import {
  canFill,
  judgeLateUpload,
  LATE_UPLOAD_GRACE_MIN,
  LenientNearbyMissionsResponseSchema,
  missionCountdownLabel,
  missionToFill,
  missionViewState,
  planRevisits,
  ProtocolSchema,
  revisitConfig,
  streetFloodDepth,
  type MissionLike,
} from "../src";

const T0 = "2026-09-26T12:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000);
const cfg = revisitConfig(streetFloodDepth)!;

describe("revisit config", () => {
  it("flood protocol ships +30/+60/+120, max 3", () => {
    expect(cfg).toEqual({ intervals_min: [30, 60, 120], max: 3, first_dibs_min: 10, window_min: 20, early_min: 5 });
  });
  it("protocols without revisit get none; the field is additive", () => {
    const { revisit: _r, ...rest } = streetFloodDepth;
    void _r;
    expect(revisitConfig(ProtocolSchema.parse(rest))).toBeNull();
  });
});

describe("planRevisits", () => {
  const base = { cfg, capturedAt: T0, now: at(1), bountyEndsAt: at(24 * 60).toISOString(), availableCents: 100_000, perMissionCents: 1_200 };

  it("schedules each interval with window, early open and first-dibs", () => {
    const r = planRevisits(base);
    expect(r.limitedBy).toBeNull();
    expect(r.missions.map((m) => m.interval_min)).toEqual([30, 60, 120]);
    expect(r.missions.map((m) => m.sequence)).toEqual([1, 2, 3]);
    const m = r.missions[0]!;
    expect(m.due_at).toBe(at(30).toISOString());
    expect(m.opens_at).toBe(at(25).toISOString());
    expect(m.dibs_until).toBe(at(35).toISOString());
    expect(m.closes_at).toBe(at(50).toISOString());
  });

  it("caps at max", () => {
    const r = planRevisits({ ...base, cfg: { ...cfg, max: 2 } });
    expect(r.missions.map((m) => m.interval_min)).toEqual([30, 60]);
  });

  it("draws on the allocation: only as many missions as the worst-case price fits", () => {
    const r = planRevisits({ ...base, availableCents: 2_500 });
    expect(r.missions).toHaveLength(2);
    expect(r.limitedBy).toBe("no_funding");
    expect(planRevisits({ ...base, availableCents: 0 }).missions).toHaveLength(0);
  });

  it("never opens after the request ends; clips closes to the end", () => {
    const r = planRevisits({ ...base, bountyEndsAt: at(70).toISOString() });
    expect(r.missions.map((m) => m.interval_min)).toEqual([30, 60]);
    expect(r.missions[1]!.closes_at).toBe(at(70).toISOString());
    expect(r.limitedBy).toBe("request_ending");
  });

  it("a late approval skips windows that already closed", () => {
    const r = planRevisits({ ...base, now: at(90) });
    expect(r.missions.map((m) => m.sequence)).toEqual([3]);
    expect(r.limitedBy).toBe("too_late");
  });
});

describe("mission matching (first dibs)", () => {
  const m: MissionLike = {
    id: "m1",
    bounty_id: "b",
    cell: "c",
    status: "open",
    sequence: 1,
    opens_at: at(25).toISOString(),
    dibs_until: at(35).toISOString(),
    closes_at: at(50).toISOString(),
    original_user_id: "orig",
    source_submission_id: "s0",
  };
  it("original contributor can fill from open; others only after dibs", () => {
    expect(canFill(m, "orig", at(26).toISOString())).toBe(true);
    expect(canFill(m, "other", at(30).toISOString())).toBe(false);
    expect(canFill(m, "other", at(36).toISOString())).toBe(true);
  });
  it("outside the window or not open → no", () => {
    expect(canFill(m, "orig", at(24).toISOString())).toBe(false);
    expect(canFill(m, "orig", at(51).toISOString())).toBe(false);
    expect(canFill({ ...m, status: "filled" }, "orig", at(30).toISOString())).toBe(false);
  });
  it("picks the earliest eligible mission in the same request + cell, never the source reading", () => {
    const m2 = { ...m, id: "m2", sequence: 2 };
    const pick = (o: Partial<Parameters<typeof missionToFill>[1]>) =>
      missionToFill([m2, m], { submissionId: "s1", userId: "orig", bountyId: "b", cell: "c", capturedAt: at(30).toISOString(), ...o });
    expect(pick({})?.id).toBe("m1");
    expect(pick({ cell: "other" })).toBeNull();
    expect(pick({ bountyId: "x" })).toBeNull();
    expect(pick({ submissionId: "s0" })).toBeNull();
  });
  it("view state + countdown copy", () => {
    const due = at(30).toISOString();
    const v = missionViewState(m, "orig", at(18));
    expect(v).toEqual({ yours: true, reserved: false, active: false });
    expect(missionCountdownLabel({ ...m, due_at: due }, at(18), v)).toBe("Revisit due in 12 min · same spot");
    const o = missionViewState(m, "other", at(30));
    expect(o.reserved).toBe(true);
    expect(missionCountdownLabel({ ...m, due_at: due }, at(31), o)).toBe("Revisit open · reserved for 4 more min");
    expect(missionCountdownLabel({ ...m, due_at: due }, at(40), missionViewState(m, "other", at(40)))).toBe("Revisit due now · 10 min left");
  });
  it("lenient list drops malformed missions instead of failing", () => {
    const r = LenientNearbyMissionsResponseSchema.parse({ missions: [{ nope: 1 }] });
    expect(r.missions).toEqual([]);
  });
});

describe("late upload grace (queued submissions)", () => {
  const s = { started_at: at(0).toISOString(), expires_at: at(15).toISOString(), gate_passed_at: at(3).toISOString() };
  it("on time is unchanged", () => {
    expect(judgeLateUpload(s, at(5).toISOString(), at(14))).toEqual({ ok: true, late: false });
    expect(judgeLateUpload({ ...s, gate_passed_at: null }, at(5).toISOString(), at(14))).toEqual({ ok: true, late: false });
  });
  it("accepts a late upload of a gate-passed session within the grace", () => {
    expect(judgeLateUpload(s, at(5).toISOString(), at(15 + LATE_UPLOAD_GRACE_MIN - 1))).toEqual({ ok: true, late: true });
  });
  it("refuses late uploads of sessions that never passed the gate", () => {
    expect(judgeLateUpload({ ...s, gate_passed_at: null }, at(5).toISOString(), at(40))).toMatchObject({ ok: false, code: "GATE_NOT_PASSED" });
  });
  it("refuses after the grace", () => {
    expect(judgeLateUpload(s, at(5).toISOString(), at(15 + LATE_UPLOAD_GRACE_MIN + 1))).toMatchObject({ ok: false, code: "UPLOAD_GRACE_EXPIRED" });
  });
  it("refuses a capture time outside the session or before the gate passed", () => {
    expect(judgeLateUpload(s, at(40).toISOString(), at(60))).toMatchObject({ ok: false, code: "CAPTURE_OUTSIDE_SESSION" });
    expect(judgeLateUpload(s, at(-10).toISOString(), at(60))).toMatchObject({ ok: false, code: "CAPTURE_OUTSIDE_SESSION" });
    expect(judgeLateUpload({ ...s, gate_passed_at: at(10).toISOString() }, at(4).toISOString(), at(60))).toMatchObject({ ok: false, code: "CAPTURE_OUTSIDE_SESSION" });
    expect(judgeLateUpload(s, "garbage", at(60))).toMatchObject({ ok: false, code: "CAPTURE_OUTSIDE_SESSION" });
  });
});
