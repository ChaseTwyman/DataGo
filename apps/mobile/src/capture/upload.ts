/**
 * Frame uploads with per-frame retry. Pure (transport + sleep injected) so it is unit-tested.
 *
 * - Each frame gets up to `attempts` tries with exponential backoff (transient failures only).
 * - Frames that already made it are remembered in `done` (owned by the caller, kept across submit
 *   attempts), so "Try again" after a failure re-sends only what's missing — never re-shoots.
 * - A retry that hits "already exists" means an earlier try landed but its response was lost:
 *   that counts as uploaded.
 */
export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`upload failed (${status})`);
    this.name = "UploadError";
  }
}

export const isDuplicateUpload = (e: unknown): boolean =>
  e instanceof UploadError && (e.status === 409 || /duplicate|already exists/i.test(e.body));

/** Worth retrying: network failures (no status), timeouts, throttling, server errors. */
export function isRetryableUpload(e: unknown): boolean {
  if (!(e instanceof UploadError)) return true;
  return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
}

export interface RetryOpts {
  attempts?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function uploadWithRetry(upload: () => Promise<void>, o: RetryOpts = {}): Promise<void> {
  const attempts = o.attempts ?? 3;
  const baseMs = o.baseMs ?? 700;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; ; i++) {
    try {
      await upload();
      return;
    } catch (e) {
      if (i > 0 && isDuplicateUpload(e)) return;
      if (i + 1 >= attempts || !isRetryableUpload(e)) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
}

/** Upload every frame not yet in `done`; frames upload in parallel, each with its own retries. */
export async function uploadFrames<F, S>(
  frames: readonly F[],
  slots: readonly S[],
  done: Set<number>,
  upload: (frame: F, slot: S) => Promise<void>,
  o: RetryOpts = {},
): Promise<void> {
  if (slots.length < frames.length) throw new Error("not enough upload slots");
  const results = await Promise.allSettled(
    frames.map(async (f, i) => {
      if (done.has(i)) return;
      await uploadWithRetry(() => upload(f, slots[i]!), o);
      done.add(i);
    }),
  );
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}
