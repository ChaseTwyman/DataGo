import type { LenientBountyDetail as BountyDetail, LenientCreateSessionResponse as CreateSessionResponse } from "@groundtruth/shared";
import { create } from "zustand";

export interface ActiveCapture {
  session: CreateSessionResponse;
  bounty: BountyDetail;
  /** How many of `session.uploads` have been used by earlier attempts. */
  usedUploads: number;
  submissionIds: string[];
}

interface CaptureStore {
  bySession: Record<string, ActiveCapture>;
  put: (c: Omit<ActiveCapture, "usedUploads" | "submissionIds">) => void;
  markSubmitted: (sessionId: string, submissionId: string, uploadsUsed: number) => void;
}

/** In-memory hand-off from briefing → capture → result (not persisted: sessions last 15 min). */
export const useCaptureStore = create<CaptureStore>((set) => ({
  bySession: {},
  put: (c) =>
    set((s) => ({ bySession: { ...s.bySession, [c.session.session_id]: { ...c, usedUploads: 0, submissionIds: [] } } })),
  markSubmitted: (sessionId, submissionId, uploadsUsed) =>
    set((s) => {
      const cur = s.bySession[sessionId];
      if (!cur) return s;
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: { ...cur, usedUploads: cur.usedUploads + uploadsUsed, submissionIds: [...cur.submissionIds, submissionId] },
        },
      };
    }),
}));

export function findCaptureBySubmission(submissionId: string): ActiveCapture | null {
  const all = Object.values(useCaptureStore.getState().bySession);
  return all.find((c) => c.submissionIds.includes(submissionId)) ?? null;
}

/** Same-session retry is possible while the session is open and unused upload slots remain. */
export function canRetryInSession(c: ActiveCapture, now = Date.now()): boolean {
  const open = new Date(c.session.expires_at).getTime() > now;
  const left = c.session.uploads.length - c.usedUploads;
  return open && left >= c.session.protocol.capture.frames;
}
