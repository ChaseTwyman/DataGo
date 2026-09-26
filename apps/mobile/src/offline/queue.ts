/**
 * Offline UPLOAD queue — not offline capture. The shutter still only unlocks on the server's gate
 * (frame checks need the network). What is queued is the upload + submit of a burst that was taken
 * in a gate-passed session when signal dropped afterwards.
 *
 * Pure state machine (storage, files, transport and clock injected) so it is unit-tested under node.
 *
 *   enqueue → waiting ──(due)──▶ sending ──ok──▶ sent (files removed)
 *                 ▲                 │
 *                 └──retryable──────┤ (backoff 5 s, 10 s, 20 s … ≤ 5 min)
 *                                   ├──past the server grace / UPLOAD_GRACE_EXPIRED──▶ discarded
 *                                   └──any other refusal──▶ failed (files removed)
 *
 * The server accepts a late submission only within LATE_UPLOAD_GRACE_MIN of the session's end and
 * only if the session's gate passed (packages/shared/src/lateUpload.ts); the phone discards at the
 * same deadline with a clear message rather than sending something that can't be accepted.
 */
import { lateUploadDeadline, type CreateSubmissionRequest, type SignedUpload } from "@groundtruth/shared";
import { ApiError } from "../api/http";
import { isDuplicateUpload, isRetryableUpload, UploadError } from "../capture/upload";

export type QueueStatus = "waiting" | "sending" | "sent" | "failed" | "discarded";

export interface QueuedFrame {
  /** Persistent local copy (app document storage). */
  uri: string;
  slot: Pick<SignedUpload, "path" | "signed_url" | "token">;
}

export interface QueuedCapture {
  /** = session id (one queued capture per session). */
  id: string;
  /** Account that captured it: only sent (and shown) while that account is signed in. */
  user_id: string;
  bounty_title: string;
  session_expires_at: string;
  /** Last moment the server will still accept it (ms since epoch). */
  deadline: number;
  frames: QueuedFrame[];
  /** Indexes of frames already uploaded. */
  uploaded: number[];
  request: CreateSubmissionRequest;
  queued_at: number;
  attempts: number;
  next_attempt_at: number;
  status: QueueStatus;
  submission_id: string | null;
  /** Contributor-facing line for the wallet/result. */
  message: string;
}

export interface QueueDeps {
  load(): Promise<QueuedCapture[]>;
  save(items: QueuedCapture[]): Promise<void>;
  /** Copies a temp frame into persistent storage; returns the new uri. */
  persistFrame(captureId: string, index: number, uri: string): Promise<string>;
  /** Deletes every persisted file of a capture (idempotent). */
  removeFiles(captureId: string): Promise<void>;
  uploadFrame(uri: string, slot: QueuedFrame["slot"]): Promise<void>;
  submit(body: CreateSubmissionRequest): Promise<{ submission_id: string }>;
  now(): number;
  /** Signed-in account, or null. Other accounts' captures are left untouched. */
  currentUser(): string | null;
}

export const MSG = {
  waiting: "Waiting for signal — your capture is saved. It sends automatically.",
  sending: "Sending your saved capture…",
  sent: "Sent for verification.",
  alreadySent: "Already sent — check your wallet for the result.",
  expired: "This saved capture was too old to send (captures must reach us within 90 minutes of the session). Please capture again.",
  failed: "We couldn't send this saved capture. Please capture again.",
} as const;

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
/** Finished entries stay visible this long, then are pruned. */
export const KEEP_FINISHED_MS = 24 * 3600_000;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** Worth retrying later: no signal, timeouts, throttling, server hiccups. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof UploadError) return isRetryableUpload(e);
  if (e instanceof ApiError) return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
  return true;
}

/** Should a failed live submit go to the queue (instead of showing an error)? */
export const shouldQueue = isRetryable;

export interface EnqueueInput {
  userId: string;
  sessionId: string;
  bountyTitle: string;
  sessionExpiresAt: string;
  frames: { uri: string; slot: QueuedFrame["slot"] }[];
  /** Frames already uploaded by the live attempt. */
  uploaded: number[];
  request: CreateSubmissionRequest;
}

export class UploadQueue {
  private items: QueuedCapture[] = [];
  private loaded = false;
  private running: Promise<void> | null = null;
  private listeners = new Set<(items: readonly QueuedCapture[]) => void>();

  constructor(private readonly d: QueueDeps) {}

  subscribe(fn: (items: readonly QueuedCapture[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.items);
    return () => this.listeners.delete(fn);
  }

  list(): readonly QueuedCapture[] {
    return this.items;
  }

  /** Entries of the signed-in account (what the UI shows). */
  mine(): readonly QueuedCapture[] {
    const u = this.d.currentUser();
    return u ? this.items.filter((q) => q.user_id === u) : [];
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      this.items = (await this.d.load()).map((q) => (q.status === "sending" ? { ...q, status: "waiting" as const } : q));
    } catch {
      this.items = [];
    }
    this.loaded = true;
    await this.prune();
  }

  async enqueue(input: EnqueueInput): Promise<QueuedCapture> {
    await this.init();
    const now = this.d.now();
    const frames: QueuedFrame[] = [];
    for (const [i, f] of input.frames.entries()) {
      frames.push({ uri: await this.d.persistFrame(input.sessionId, i, f.uri), slot: f.slot });
    }
    const q: QueuedCapture = {
      id: input.sessionId,
      user_id: input.userId,
      bounty_title: input.bountyTitle,
      session_expires_at: input.sessionExpiresAt,
      deadline: lateUploadDeadline(input.sessionExpiresAt),
      frames,
      uploaded: [...input.uploaded],
      request: input.request,
      queued_at: now,
      attempts: 0,
      next_attempt_at: now + BACKOFF_BASE_MS,
      status: "waiting",
      submission_id: null,
      message: MSG.waiting,
    };
    this.items = [...this.items.filter((x) => x.id !== q.id), q];
    await this.commit();
    return q;
  }

  /** App became active / launched / connectivity likely back: try every waiting capture now. */
  async retryNow(): Promise<void> {
    await this.init();
    const now = this.d.now();
    const u = this.d.currentUser();
    this.items = this.items.map((q) => (q.status === "waiting" && q.user_id === u ? { ...q, next_attempt_at: now } : q));
    await this.commit();
    await this.process();
  }

  async dismiss(id: string): Promise<void> {
    await this.init();
    const q = this.items.find((x) => x.id === id);
    if (!q || q.status === "sending" || q.user_id !== this.d.currentUser()) return;
    await this.d.removeFiles(id).catch(() => undefined);
    this.items = this.items.filter((x) => x.id !== id);
    await this.commit();
  }

  /** When the next waiting capture is due (ms since epoch), or null. */
  nextDueAt(): number | null {
    const u = this.d.currentUser();
    const due = this.items.filter((q) => q.status === "waiting" && q.user_id === u).map((q) => Math.min(q.next_attempt_at, q.deadline + 1));
    return due.length ? Math.min(...due) : null;
  }

  /** Runs every due capture once. Serialised: concurrent calls share one run. */
  process(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        await this.init();
        for (const q of [...this.items]) {
          if (q.status !== "waiting") continue;
          // Never send another account's capture with this account's token (shared phone).
          if (q.user_id !== this.d.currentUser()) continue;
          const now = this.d.now();
          if (now > q.deadline) {
            await this.finish(q.id, "discarded", MSG.expired);
            continue;
          }
          if (q.next_attempt_at > now) continue;
          await this.attempt(q.id);
        }
        await this.prune();
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async attempt(id: string): Promise<void> {
    await this.update(id, { status: "sending", message: MSG.sending });
    const q = this.items.find((x) => x.id === id)!;
    const uploaded = new Set(q.uploaded);
    try {
      for (const [i, f] of q.frames.entries()) {
        if (uploaded.has(i)) continue;
        try {
          await this.d.uploadFrame(f.uri, f.slot);
        } catch (e) {
          // An earlier try landed but its response was lost.
          if (!isDuplicateUpload(e)) throw e;
        }
        uploaded.add(i);
        await this.update(id, { uploaded: [...uploaded].sort((a, b) => a - b) });
      }
      const res = await this.d.submit(q.request);
      await this.finish(id, "sent", MSG.sent, res.submission_id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "SESSION_ALREADY_SUBMITTED") {
        await this.finish(id, "sent", MSG.alreadySent);
      } else if (e instanceof ApiError && e.code === "UPLOAD_GRACE_EXPIRED") {
        await this.finish(id, "discarded", MSG.expired);
      } else if (isRetryable(e) && this.d.now() <= q.deadline) {
        const attempts = q.attempts + 1;
        await this.update(id, { status: "waiting", attempts, next_attempt_at: this.d.now() + backoffMs(attempts), message: MSG.waiting });
      } else if (isRetryable(e)) {
        await this.finish(id, "discarded", MSG.expired);
      } else {
        await this.finish(id, "failed", MSG.failed);
      }
    }
  }

  private async finish(id: string, status: QueueStatus, message: string, submissionId: string | null = null): Promise<void> {
    await this.d.removeFiles(id).catch(() => undefined);
    await this.update(id, { status, message, submission_id: submissionId, frames: [], next_attempt_at: this.d.now() });
  }

  private async prune(): Promise<void> {
    const now = this.d.now();
    const before = this.items.length;
    this.items = this.items.filter((q) => q.status === "waiting" || q.status === "sending" || now - q.next_attempt_at < KEEP_FINISHED_MS);
    if (this.items.length !== before) await this.commit();
  }

  private async update(id: string, patch: Partial<QueuedCapture>): Promise<void> {
    this.items = this.items.map((q) => (q.id === id ? { ...q, ...patch } : q));
    await this.commit();
  }

  private async commit(): Promise<void> {
    try {
      await this.d.save(this.items);
    } catch {
      // Storage full/unavailable: keep going in memory; the next commit retries.
    }
    for (const l of this.listeners) l(this.items);
  }
}
