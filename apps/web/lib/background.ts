/**
 * Runs work after the response via next/server `after()`. Outside a request scope (vitest calling
 * route handlers directly, scripts) `after` throws, so tests opt into a queue they can drain.
 */
import { after } from "next/server";

const g = globalThis as typeof globalThis & { __gtBg?: { queue: Promise<unknown>[] | null } };
const state = (g.__gtBg ??= { queue: null });

function guarded(fn: () => Promise<unknown>): Promise<void> {
  return fn().then(
    () => undefined,
    (err) => console.error("[background] task failed", err),
  );
}

export function runInBackground(fn: () => Promise<unknown>): void {
  if (state.queue) {
    state.queue.push(guarded(fn));
    return;
  }
  try {
    after(() => guarded(fn));
  } catch {
    void guarded(fn);
  }
}

/** Tests: route background tasks into a queue instead of `after()`. */
export function captureBackground(): void {
  state.queue = [];
}

/** Awaits every queued task (including tasks queued while draining). */
export async function drainBackground(): Promise<void> {
  while (state.queue && state.queue.length > 0) {
    const batch = state.queue.splice(0);
    await Promise.all(batch);
  }
}
