import { describe, expect, it } from "vitest";
import { LATE_UPLOAD_GRACE_MIN, type CreateSubmissionRequest } from "@groundtruth/shared";
import { ApiError } from "../src/api/http";
import { UploadError } from "../src/capture/upload";
import { backoffMs, BACKOFF_MAX_MS, MSG, shouldQueue, UploadQueue, type QueueDeps, type QueuedCapture } from "../src/offline/queue";

const T0 = Date.parse("2026-09-26T12:10:00.000Z");
const EXPIRES = "2026-09-26T12:15:00.000Z";

function harness(opts: { upload?: (i: string) => Promise<void>; submit?: () => Promise<{ submission_id: string }> } = {}) {
  let now = T0;
  let disk: QueuedCapture[] = [];
  const files = new Set<string>();
  const calls = { upload: [] as string[], submit: 0, saves: 0 };
  const deps: QueueDeps = {
    load: async () => JSON.parse(JSON.stringify(disk)) as QueuedCapture[],
    save: async (items) => {
      calls.saves++;
      disk = JSON.parse(JSON.stringify(items)) as QueuedCapture[];
    },
    persistFrame: async (id, i) => {
      const uri = `file:///doc/queue/${id}/${i}.jpg`;
      files.add(uri);
      return uri;
    },
    removeFiles: async (id) => {
      for (const f of [...files]) if (f.includes(`/${id}/`)) files.delete(f);
    },
    uploadFrame: async (uri) => {
      calls.upload.push(uri);
      await (opts.upload ?? (async () => undefined))(uri);
    },
    submit: async () => {
      calls.submit++;
      return (opts.submit ?? (async () => ({ submission_id: "sub-1" })))();
    },
    now: () => now,
  };
  return {
    deps,
    files,
    calls,
    disk: () => disk,
    advance: (ms: number) => {
      now += ms;
    },
    queue: () => new UploadQueue(deps),
  };
}

const request = { session_id: "s1", nonce: "n", captured_at: "2026-09-26T12:09:00.000Z" } as unknown as CreateSubmissionRequest;
const input = {
  sessionId: "s1",
  bountyTitle: "Midtown flood",
  sessionExpiresAt: EXPIRES,
  frames: [0, 1, 2].map((i) => ({ uri: `file:///tmp/${i}.jpg`, slot: { path: `observations/u/s1/${i}.jpg`, signed_url: `https://x/${i}`, token: "t" } })),
  uploaded: [0],
  request,
};
const offline = () => Promise.reject(new UploadError(0, "offline"));

describe("offline upload queue", () => {
  it("only network-type failures are queued (never refusals)", () => {
    expect(shouldQueue(new ApiError(0, "NETWORK", "x"))).toBe(true);
    expect(shouldQueue(new ApiError(503, "HTTP_503", "x"))).toBe(true);
    expect(shouldQueue(new UploadError(0, ""))).toBe(true);
    expect(shouldQueue(new ApiError(409, "GATE_NOT_PASSED", "x"))).toBe(false);
    expect(shouldQueue(new UploadError(403, "forbidden"))).toBe(false);
  });

  it("persists frames + request, survives a restart (launch resume), and sends only missing frames", async () => {
    const h = harness();
    const q = h.queue();
    const e = await q.enqueue(input);
    expect(e).toMatchObject({ status: "waiting", message: MSG.waiting, uploaded: [0] });
    expect(e.deadline).toBe(Date.parse(EXPIRES) + LATE_UPLOAD_GRACE_MIN * 60_000);
    expect([...h.files]).toHaveLength(3);
    expect(h.disk()).toHaveLength(1);

    // app killed; next launch: a new queue loads from disk and resumes
    const q2 = h.queue();
    await q2.retryNow();
    expect(h.calls.upload).toEqual(["file:///doc/queue/s1/1.jpg", "file:///doc/queue/s1/2.jpg"]);
    expect(h.calls.submit).toBe(1);
    expect(q2.list()[0]).toMatchObject({ status: "sent", submission_id: "sub-1", message: MSG.sent });
    expect(h.files.size).toBe(0);
  });

  it("retries with exponential backoff while offline, remembering frames that made it", async () => {
    let failAfter = 1;
    const h = harness({
      upload: async () => {
        if (failAfter-- <= 0) throw new UploadError(0, "offline");
      },
    });
    const q = h.queue();
    await q.enqueue({ ...input, uploaded: [] });
    await q.process(); // not due yet (first attempt after the base delay)
    expect(h.calls.upload).toHaveLength(0);
    h.advance(5_000);
    await q.process();
    expect(q.list()[0]).toMatchObject({ status: "waiting", attempts: 1, uploaded: [0] });
    expect(q.list()[0]!.next_attempt_at).toBe(T0 + 5_000 + backoffMs(1));
    h.advance(backoffMs(1) - 1);
    await q.process();
    expect(q.list()[0]!.attempts).toBe(1); // not yet due
    h.advance(1);
    await q.process();
    expect(q.list()[0]).toMatchObject({ attempts: 2 });
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(20)).toBe(BACKOFF_MAX_MS);
    // signal back
    failAfter = 99;
    await q.retryNow();
    expect(q.list()[0]).toMatchObject({ status: "sent" });
    expect(h.calls.upload.filter((u) => u.endsWith("/0.jpg"))).toHaveLength(1);
  });

  it("discards captures past the server grace with a clear message (and deletes the files)", async () => {
    const h = harness({ upload: offline });
    const q = h.queue();
    await q.enqueue(input);
    h.advance(5 * 60_000 + LATE_UPLOAD_GRACE_MIN * 60_000 + 1);
    await q.retryNow();
    expect(q.list()[0]).toMatchObject({ status: "discarded", message: MSG.expired });
    expect(h.calls.upload).toHaveLength(0);
    expect(h.files.size).toBe(0);
  });

  it("server refusals: grace expired → discarded; already submitted → sent; anything else → failed", async () => {
    for (const [err, status, msg] of [
      [new ApiError(410, "UPLOAD_GRACE_EXPIRED", "x"), "discarded", MSG.expired],
      [new ApiError(409, "SESSION_ALREADY_SUBMITTED", "x"), "sent", MSG.alreadySent],
      [new ApiError(409, "GATE_NOT_PASSED", "x"), "failed", MSG.failed],
    ] as const) {
      const h = harness({ submit: () => Promise.reject(err) });
      const q = h.queue();
      await q.enqueue(input);
      await q.retryNow();
      expect(q.list()[0]).toMatchObject({ status, message: msg });
      expect(h.files.size).toBe(0);
    }
  });

  it("an interrupted 'sending' entry is resumed as waiting on launch; finished entries are pruned after a day; dismiss removes", async () => {
    const h = harness({ upload: offline });
    const q = h.queue();
    await q.enqueue(input);
    await h.deps.save(h.disk().map((x) => ({ ...x, status: "sending" as const })));
    const q2 = h.queue();
    await q2.init();
    expect(q2.list()[0]!.status).toBe("waiting");
    await q2.dismiss("s1");
    expect(q2.list()).toHaveLength(0);
    expect(h.files.size).toBe(0);

    const h2 = harness();
    const q3 = h2.queue();
    await q3.enqueue(input);
    await q3.retryNow();
    expect(q3.list()[0]!.status).toBe("sent");
    h2.advance(25 * 3600_000);
    await q3.process();
    expect(q3.list()).toHaveLength(0);
  });

  it("concurrent triggers share one run (no double submit)", async () => {
    const h = harness();
    const q = h.queue();
    await q.enqueue(input);
    await Promise.all([q.retryNow(), q.retryNow(), q.process()]);
    expect(h.calls.submit).toBe(1);
  });
});
