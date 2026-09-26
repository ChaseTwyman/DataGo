/**
 * Revisit missions: pure scheduling + matching rules (server uses them; tests pin them).
 *
 * Timeline of one mission (times after the ORIGINAL capture, flood default):
 *   opens_at = capture + interval − early      (visible before as "due in N min")
 *   due_at   = capture + interval
 *   dibs_until = opens_at + first_dibs          (only the original contributor may fill it)
 *   closes_at = due_at + window                 (then it expires)
 */
import type { Protocol, RevisitConfig } from "./protocols/protocol";

export const REVISIT_DEFAULTS = { first_dibs_min: 10, window_min: 20, early_min: 5 } as const;

export function revisitConfig(protocol: Pick<Protocol, "revisit">): Required<RevisitConfig> | null {
  const r = protocol.revisit;
  if (!r || r.intervals_min.length === 0 || r.max <= 0) return null;
  return {
    intervals_min: [...new Set(r.intervals_min)].sort((a, b) => a - b),
    max: r.max,
    first_dibs_min: r.first_dibs_min ?? REVISIT_DEFAULTS.first_dibs_min,
    window_min: r.window_min ?? REVISIT_DEFAULTS.window_min,
    early_min: r.early_min ?? REVISIT_DEFAULTS.early_min,
  };
}

export interface PlannedMission {
  sequence: number;
  interval_min: number;
  opens_at: string;
  due_at: string;
  dibs_until: string;
  closes_at: string;
}

export interface PlanInput {
  cfg: Required<RevisitConfig>;
  /** The original reading's capture time. */
  capturedAt: string;
  now: Date;
  /** The request's end: no mission may open at or after it (and closes are clipped to it). */
  bountyEndsAt: string;
  /** Allocation the request can still promise, after locked quotes and already-open missions. */
  availableCents: number;
  /** Worst-case cost of one mission reading (cell price × best quality multiplier). */
  perMissionCents: number;
}

export type PlanSkip = "no_funding" | "request_ending" | "too_late";

export interface PlanResult {
  missions: PlannedMission[];
  /** Why fewer than cfg.max missions were planned (first limiting reason), or null. */
  limitedBy: PlanSkip | null;
}

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Plans the follow-ups for one accepted reading: capped by `max`, by the request's end, by the
 * clock (a late human approval skips windows already closed), and by funding (each mission must be
 * coverable from the allocation at the worst-case price — missions never bypass the allocation).
 */
export function planRevisits(p: PlanInput): PlanResult {
  const t0 = Date.parse(p.capturedAt);
  const end = Date.parse(p.bountyEndsAt);
  const now = p.now.getTime();
  const out: PlannedMission[] = [];
  let limitedBy: PlanSkip | null = null;
  let budget = p.availableCents;
  const intervals = p.cfg.intervals_min.slice(0, p.cfg.max);
  for (const interval of intervals) {
    const due = t0 + interval * MIN;
    const opens = due - p.cfg.early_min * MIN;
    const closes = Math.min(due + p.cfg.window_min * MIN, end);
    if (opens >= end || closes <= opens) {
      limitedBy ??= "request_ending";
      continue;
    }
    if (closes <= now) {
      limitedBy ??= "too_late";
      continue;
    }
    if (p.perMissionCents <= 0 || budget < p.perMissionCents) {
      limitedBy ??= "no_funding";
      continue;
    }
    budget -= p.perMissionCents;
    out.push({
      sequence: 0,
      interval_min: interval,
      opens_at: iso(opens),
      due_at: iso(due),
      dibs_until: iso(Math.min(opens + p.cfg.first_dibs_min * MIN, closes)),
      closes_at: iso(closes),
    });
  }
  // Sequence is the position in the full schedule (1 = first interval), stable even when skipped.
  for (const m of out) m.sequence = intervals.indexOf(m.interval_min) + 1;
  return { missions: out, limitedBy };
}

export interface MissionLike {
  id: string;
  bounty_id: string;
  cell: string;
  status: string;
  sequence: number;
  opens_at: string;
  dibs_until: string;
  closes_at: string;
  original_user_id: string | null;
  source_submission_id: string;
}

/** Can `userId` fill this mission with a reading captured at `capturedAt`? */
export function canFill(m: MissionLike, userId: string, capturedAt: string): boolean {
  if (m.status !== "open") return false;
  const t = Date.parse(capturedAt);
  if (!(t >= Date.parse(m.opens_at) && t <= Date.parse(m.closes_at))) return false;
  if (m.original_user_id === userId) return true;
  return t >= Date.parse(m.dibs_until);
}

/**
 * The mission an accepted reading fills: same request + cell, open, capture inside its window, the
 * caller eligible (first dibs), never the reading that created it; earliest sequence first.
 */
export function missionToFill<M extends MissionLike>(
  missions: readonly M[],
  r: { submissionId: string; userId: string; bountyId: string; cell: string; capturedAt: string },
): M | null {
  const ok = missions
    .filter((m) => m.bounty_id === r.bountyId && m.cell === r.cell && m.source_submission_id !== r.submissionId)
    .filter((m) => canFill(m, r.userId, r.capturedAt))
    .sort((a, b) => a.sequence - b.sequence);
  return ok[0] ?? null;
}

/** Contributor-facing view state of a mission at `now` for `userId`. */
export function missionViewState(m: MissionLike, userId: string, now: Date): { yours: boolean; reserved: boolean; active: boolean } {
  const t = now.getTime();
  const yours = m.original_user_id === userId;
  const active = m.status === "open" && t >= Date.parse(m.opens_at) && t <= Date.parse(m.closes_at);
  const reserved = !yours && t < Date.parse(m.dibs_until);
  return { yours, reserved, active };
}

/** "Revisit due in 12 min · same spot" / "Revisit open now · 8 min left" / "Reserved for 3 min". */
export function missionCountdownLabel(m: Pick<MissionLike, "opens_at" | "closes_at" | "dibs_until"> & { due_at: string }, now: Date, s: { yours: boolean; reserved: boolean }): string {
  const t = now.getTime();
  const mins = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - t) / MIN));
  const spot = s.yours ? " · same spot" : "";
  if (t < Date.parse(m.due_at)) {
    const base = `Revisit due in ${mins(m.due_at)} min${spot}`;
    return s.reserved ? `${base} · first dibs to the original contributor` : base;
  }
  if (t <= Date.parse(m.closes_at)) {
    if (s.reserved) return `Revisit open · reserved for ${mins(m.dibs_until)} more min`;
    return `Revisit due now · ${mins(m.closes_at)} min left${spot}`;
  }
  return "Revisit closed";
}
