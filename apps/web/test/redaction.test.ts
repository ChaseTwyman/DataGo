/**
 * Face / licence-plate redaction: pixel ops, the post-decision job, and who can see which photo.
 * Route handlers on PGlite with MOCK_GROK (the mock detector returns one face + one plate box).
 */
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CreateSessionResponseSchema, CreateSubmissionRequestSchema, DEMO, SubmissionListResponseSchema, SubmissionWithMediaSchema, type CreateSessionResponse } from "@groundtruth/shared";
import { captureBackground, drainBackground } from "@/lib/background";
import { devTokenFor } from "@/lib/auth";
import { setContextFetch } from "@/lib/context/fetcher";
import { ensureDevUser } from "@/lib/db/repos/profiles";
import { getSubmission, redactionBacklog } from "@/lib/db/repos/submissions";
import { dHash } from "@/lib/image/dhash";
import { redactedPathFor, redactImage, toPixelRect } from "@/lib/image/redact";
import { purgeRejectedMedia } from "@/lib/retention";
import { liveRedactionDeps, redactSubmission, type RedactionDeps } from "@/lib/verification/redaction";
import { MOCK_PRIVACY_REGIONS } from "@/lib/grok/mocks/fixtures";
import { POST as devSession } from "@/app/api/dev/session/route";
import { PUT as devUpload } from "@/app/api/dev/upload/route";
import { POST as createSession } from "@/app/api/capture/sessions/route";
import { POST as createSubmission, GET as listSubmissions } from "@/app/api/submissions/route";
import { GET as getSubmissionRoute } from "@/app/api/submissions/[id]/route";
import { POST as redteamRun } from "@/app/api/redteam/run/route";
import { GET as redteamRuns } from "@/app/api/redteam/runs/route";
import { researcherMediaUrl } from "@/lib/api/views";
import { idCtx, passGate, req, setupTestEnv, type TestEnv } from "./helpers";

const noCtx = undefined as unknown;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Per-pixel random noise: high variance everywhere, so blurring any region is measurable. */
let noiseSeed = 1;
async function noiseJpeg(width = 640, height = 480): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let a = (noiseSeed++ * 2654435761) >>> 0;
  for (let i = 0; i < raw.length; i++) {
    a = (Math.imul(a, 1103515245) + 12345) >>> 0;
    raw[i] = a >>> 24;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

async function regionStats(jpeg: Buffer, rect: { left: number; top: number; width: number; height: number }) {
  const px = await sharp(jpeg).extract(rect).greyscale().raw().toBuffer();
  const mean = px.reduce((s, v) => s + v, 0) / px.length;
  const variance = px.reduce((s, v) => s + (v - mean) ** 2, 0) / px.length;
  return { mean, variance, px };
}

describe("redactImage (pixels)", () => {
  it("destroys detail inside each (grown) box and leaves far-away pixels alone", async () => {
    const orig = await noiseJpeg();
    const box = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };
    const out = await redactImage(orig, [box]);
    expect(out.rects).toHaveLength(1);
    const inner = { left: 64, top: 48, width: 64, height: 48 }; // the box itself
    const before = await regionStats(orig, inner);
    const after = await regionStats(out.bytes, inner);
    expect(after.variance).toBeLessThan(before.variance * 0.05);
    // Bottom-right corner is far outside the grown rect: essentially unchanged (JPEG re-encode only).
    const far = { left: 560, top: 400, width: 64, height: 64 };
    const a = await regionStats(orig, far);
    const b = await regionStats(out.bytes, far);
    const meanAbsDiff = a.px.reduce((s, v, i) => s + Math.abs(v - b.px[i]!), 0) / a.px.length;
    expect(meanAbsDiff).toBeLessThan(12);
    expect(b.variance).toBeGreaterThan(a.variance * 0.5);
  });

  it("grows each box by max(1× its size, 8 % of the long edge), clamped to the image", () => {
    // 1000×500 image, box 100×50 at (500, 250): pad x = max(100, 80) = 100, pad y = max(50, 80) = 80.
    expect(toPixelRect({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 1000, 500)).toEqual({ left: 400, top: 170, width: 300, height: 210 });
    // Near the corner: clamped.
    expect(toPixelRect({ x: 0, y: 0, w: 0.05, h: 0.05 }, 1000, 500)).toEqual({ left: 0, top: 0, width: 130, height: 105 });
    expect(toPixelRect({ x: 0.5, y: 0.5, w: 0, h: 0.1 }, 1000, 500)).toBeNull();
  });

  it("whole-frame mode obscures everything; output carries no EXIF", async () => {
    const orig = await sharp(await noiseJpeg()).withMetadata({ exif: { IFD0: { Copyright: "gps-ish" } } }).jpeg().toBuffer();
    const out = await redactImage(orig, [], { wholeFrame: true });
    const all = { left: 0, top: 0, width: 640, height: 480 };
    expect((await regionStats(out.bytes, all)).variance).toBeLessThan((await regionStats(orig, all)).variance * 0.05);
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
  });

  it("derivative path is a sibling in the same private folder", () => {
    expect(redactedPathFor("observations/u/s/0.jpg")).toBe("observations/u/s/0.redacted.jpg");
    expect(redactedPathFor("observations/u/s/frame")).toBe("observations/u/s/frame.redacted.jpg");
  });
});

describe("redaction job + media access (routes, PGlite, MOCK_GROK)", () => {
  let env: TestEnv;
  let admin: string;
  let researcher: { id: string; token: string };
  const uploads = new Map<string, Buffer>();

  beforeAll(async () => {
    vi.stubEnv("LOCAL_BACKEND", "1");
    vi.stubEnv("MOCK_GROK", "1");
    vi.stubEnv("DEMO_MODE", "1");
    env = await setupTestEnv();
    captureBackground();
    setContextFetch(async () => Response.json({ features: [] }));
    admin = ((await (await devSession(req("POST", "/api/dev/session", { body: { role: "researcher" } }), noCtx)).json()) as { access_token: string }).access_token;
    // A self-serve (non-admin) researcher who owns the demo bounty.
    const rid = randomUUID();
    await ensureDevUser(env.db, rid, "researcher");
    await env.db.query("update public.bounties set created_by = $1 where id = $2", [rid, DEMO.bountyId]);
    researcher = { id: rid, token: devTokenFor(rid) };
  }, 60_000);
  afterAll(async () => {
    setContextFetch(null);
    vi.unstubAllEnvs();
    await env.close();
  });

  async function contributor() {
    const r = await devSession(req("POST", "/api/dev/session", { body: { role: "contributor" } }), noCtx);
    const b = (await r.json()) as { access_token: string; user_id: string };
    return { token: b.access_token, id: b.user_id };
  }

  async function submitGenuine(): Promise<{ id: string; token: string; session: CreateSessionResponse }> {
    const c = await contributor();
    const r = await createSession(
      req("POST", "/api/capture/sessions", { token: c.token, body: { bounty_id: DEMO.bountyId, lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5 } }),
      noCtx,
    );
    const s = CreateSessionResponseSchema.parse(await r.json());
    for (const u of s.uploads) {
      const bytes = await noiseJpeg();
      uploads.set(u.path, bytes);
      const url = new URL(u.signed_url);
      await devUpload(req("PUT", url.pathname + url.search, { raw: bytes }), noCtx);
    }
    await passGate(c.token, s.session_id);
    const at = new Date().toISOString();
    const body = {
      session_id: s.session_id,
      nonce: s.nonce,
      // A client-supplied redacted_path must be ignored (it would let a contributor pick what researchers see).
      media: s.uploads.map((u) => ({ path: u.path, captured_at: at, redacted_path: u.path })),
      lat: DEMO.lat,
      lng: DEMO.lng,
      accuracy_m: 5,
      captured_at: at,
      device: { model: "iPhone 16", os: "ios", os_version: "26.0", app_version: "0.1.0" },
      sensors: { tilt_deg: 3, rotation_rate: 0.1, steady: true },
      field_notes: { water_state: "still", debris_present: false },
      gate: { degraded: false, frame_checks: 2, consecutive_green: 2, last_hint: "Hold still." },
    };
    const res = await createSubmission(req("POST", "/api/submissions", { token: c.token, body }), noCtx);
    expect(res.status).toBe(202);
    const { submission_id } = (await res.json()) as { submission_id: string };
    return { id: submission_id, token: c.token, session: s };
  }

  const view = async (id: string, token: string) =>
    SubmissionWithMediaSchema.parse(await (await getSubmissionRoute(req("GET", `/api/submissions/${id}`, { token }), idCtx(id))).json());

  it("the create contract strips client redacted_path", () => {
    const parsed = CreateSubmissionRequestSchema.shape.media.element.parse({ path: "observations/a/b/0.jpg", captured_at: new Date().toISOString(), redacted_path: "x" });
    expect(parsed).not.toHaveProperty("redacted_path");
  });

  it("after the decision: derivatives written, originals untouched, hashes from originals, decision unchanged", async () => {
    const { id } = await submitGenuine();
    await drainBackground();
    const row = (await getSubmission(env.db, id))!;
    expect(row.status).toBe("accepted");
    expect(row.redaction?.status).toBe("done");
    expect(row.redaction?.frames).toEqual(row.media.map(() => ({ faces: 1, plates: 1 })));
    for (const m of row.media) {
      expect(m.redacted_path).toBe(redactedPathFor(m.path));
      const original = await env.storage.get(m.path);
      expect(sha(original)).toBe(sha(uploads.get(m.path)!)); // original bytes never rewritten
      const derived = await env.storage.get(m.redacted_path!);
      // The mock face box (0.1, 0.1, 0.2, 0.25) of a 640×480 frame is blurred in the derivative.
      const box = { left: 64, top: 48, width: 128, height: 120 };
      expect((await regionStats(derived, box)).variance).toBeLessThan((await regionStats(original, box)).variance * 0.05);
    }
    // dHash (duplicates) was computed from the originals, not the derivatives.
    expect(row.phashes).toEqual(await Promise.all(row.media.map(async (m) => dHash(uploads.get(m.path)!))));
  });

  it("researchers (list + detail) get only redacted URLs; admins also get originals; the contributor sees their own originals", async () => {
    const { id, token } = await submitGenuine();
    await drainBackground();
    const row = (await getSubmission(env.db, id))!;

    const list = SubmissionListResponseSchema.parse(await (await listSubmissions(req("GET", `/api/submissions?bounty_id=${DEMO.bountyId}`, { token: researcher.token }), noCtx)).json());
    const mine = list.submissions.find((s) => s.id === id)!;
    expect(mine.media_variant).toBe("redacted");
    expect(mine.original_media_urls).toBeUndefined();
    expect(mine.media_urls).toHaveLength(3);
    for (const [i, u] of mine.media_urls.entries()) {
      expect(decodeURIComponent(u)).toContain(row.media[i]!.redacted_path!);
    }
    // No URL in the researcher payload points at an original (every one is a .redacted.jpg).
    for (const u of mine.media_urls) expect(decodeURIComponent(u)).toMatch(/path=observations\/[^&]+\/\d+\.redacted\.jpg&/);

    const detail = await view(id, researcher.token);
    expect(detail.media_urls.every((u) => decodeURIComponent(u).includes(".redacted.jpg"))).toBe(true);

    const asAdmin = await view(id, admin);
    expect(asAdmin.media_variant).toBe("redacted");
    expect(asAdmin.media_urls.every((u) => decodeURIComponent(u).includes(".redacted.jpg"))).toBe(true);
    expect(asAdmin.original_media_urls).toHaveLength(3);
    for (const [i, u] of asAdmin.original_media_urls!.entries()) {
      expect(decodeURIComponent(u)).toContain(`path=${row.media[i]!.path}&`);
    }

    const own = await view(id, token);
    expect(own.media_variant).toBe("original");
    expect(own.original_media_urls).toBeUndefined();
    expect(own.media_urls.every((u) => !decodeURIComponent(u).includes(".redacted"))).toBe(true);
  });

  it("failure never changes the decision; researchers see no photo (not the original); a retry succeeds", async () => {
    const { id } = await submitGenuine();
    await drainBackground();
    // Back to "never redacted", then run the job with a detector that fails.
    await env.db.query("update public.submissions set redaction = null, media = (select jsonb_agg(m - 'redacted_path') from jsonb_array_elements(media) m) where id = $1", [id]);
    const before = (await getSubmission(env.db, id))!;
    await env.storage.remove(before.media.map((m) => redactedPathFor(m.path)));

    const failing: RedactionDeps = { ...liveRedactionDeps(env.storage), detect: async () => { throw new Error("grok down"); } };
    expect(await redactSubmission(env.db, id, failing)).toBe("failed");
    const after = (await getSubmission(env.db, id))!;
    expect(after.status).toBe(before.status);
    expect(after.confidence).toBe(before.confidence);
    expect(after.payout_cents).toBe(before.payout_cents);
    expect(after.verifier).toBe(before.verifier);
    expect(after.redaction).toMatchObject({ status: "failed", attempts: 1 });
    expect(after.media.every((m) => !m.redacted_path)).toBe(true);
    for (const m of after.media) expect(await env.storage.exists(redactedPathFor(m.path))).toBe(false);

    const r = await view(id, researcher.token);
    expect(r.media_urls).toEqual(["", "", ""]); // fail closed

    expect(await redactionBacklog(env.db, 1000)).toContain(id);
    expect(await redactSubmission(env.db, id, liveRedactionDeps(env.storage))).toBe("done");
    const done = (await getSubmission(env.db, id))!;
    expect(done.redaction).toMatchObject({ status: "done", attempts: 2 });
    expect(await redactionBacklog(env.db, 1000)).not.toContain(id);
    // Idempotent: a second run is a no-op.
    expect(await redactSubmission(env.db, id, liveRedactionDeps(env.storage))).toBe("skipped");
  });

  it("a partially failing frame leaves no derivatives behind", async () => {
    const { id } = await submitGenuine();
    await drainBackground();
    await env.db.query("update public.submissions set redaction = null, media = (select jsonb_agg(m - 'redacted_path') from jsonb_array_elements(media) m) where id = $1", [id]);
    const row = (await getSubmission(env.db, id))!;
    await env.storage.remove(row.media.map((m) => redactedPathFor(m.path)));
    let n = 0;
    const flaky: RedactionDeps = {
      ...liveRedactionDeps(env.storage),
      detect: async () => {
        if (++n === 2) throw new Error("second frame failed");
        return { faces_or_plates_present: true, regions: MOCK_PRIVACY_REGIONS.map((r) => ({ ...r })) };
      },
    };
    expect(await redactSubmission(env.db, id, flaky)).toBe("failed");
    for (const m of row.media) expect(await env.storage.exists(redactedPathFor(m.path))).toBe(false);
  });

  it("never reads or writes through a path outside the contributor's own folder", async () => {
    const { id } = await submitGenuine();
    await drainBackground();
    const other = `observations/${randomUUID()}/s/0.jpg`;
    await env.storage.put(other, await noiseJpeg());
    await env.db.query(
      "update public.submissions set redaction = null, media = jsonb_build_array(jsonb_build_object('path', $2::text, 'captured_at', $3::text)) where id = $1",
      [id, other, new Date().toISOString()],
    );
    let called = 0;
    const deps: RedactionDeps = { ...liveRedactionDeps(env.storage), detect: async () => (called++, { faces_or_plates_present: false, regions: [] }) };
    expect(await redactSubmission(env.db, id, deps)).toBe("done");
    expect(called).toBe(0);
    expect(await env.storage.exists(redactedPathFor(other))).toBe(false);
    expect((await view(id, researcher.token)).media_urls).toEqual([""]);
  });

  it("retention deletes the redacted derivatives with the originals", async () => {
    const { id } = await submitGenuine();
    await drainBackground();
    await env.db.query("update public.submissions set status = 'rejected', received_at = now() - interval '40 days' where id = $1", [id]);
    const row = (await getSubmission(env.db, id))!;
    expect(row.media.every((m) => m.redacted_path)).toBe(true);
    await purgeRejectedMedia(env.db, env.storage, { days: 30 });
    for (const m of row.media) {
      expect(await env.storage.exists(m.path)).toBe(false);
      expect(await env.storage.exists(m.redacted_path!)).toBe(false);
    }
  });

  it("red-team 'recycled' runs show a non-admin researcher the (single) redacted derivative, admins the original", async () => {
    const { id } = await submitGenuine();
    await drainBackground();
    const src = (await getSubmission(env.db, id))!;
    const run = await redteamRun(req("POST", "/api/redteam/run", { token: researcher.token, body: { bounty_id: DEMO.bountyId, attack_type: "recycled" } }), noCtx);
    expect(run.status).toBe(200);
    const immediate = (await run.json()) as { image_url: string | null };
    expect(decodeURIComponent(immediate.image_url ?? "")).toContain(`path=${src.media[0]!.redacted_path}&`);

    const list = async (token: string) =>
      ((await (await redteamRuns(req("GET", `/api/redteam/runs?bounty_id=${DEMO.bountyId}`, { token }), noCtx)).json()) as { runs: { image_url: string | null }[] }).runs[0]!;
    const asResearcher = decodeURIComponent((await list(researcher.token)).image_url ?? "");
    expect(asResearcher).toContain(`path=${src.media[0]!.redacted_path}&`);
    expect(asResearcher).not.toContain(".redacted.redacted");
    expect(decodeURIComponent((await list(admin)).image_url ?? "")).toContain(`path=${src.media[0]!.path}&`);
  });

  it("researcherMediaUrl: no URL while the derivative doesn't exist; never double-redacts", async () => {
    const orig = `observations/${randomUUID()}/s/0.jpg`;
    expect(await researcherMediaUrl(orig, "http://localhost:3000", { isAdmin: false })).toBeNull();
    await env.storage.put(redactedPathFor(orig), await noiseJpeg());
    expect(decodeURIComponent((await researcherMediaUrl(orig, "http://localhost:3000", { isAdmin: false }))!)).toContain(`path=${redactedPathFor(orig)}&`);
    expect(decodeURIComponent((await researcherMediaUrl(redactedPathFor(orig), "http://localhost:3000", { isAdmin: false }))!)).toContain(`path=${redactedPathFor(orig)}&`);
  });

  it("a second concurrent run of the job is refused by the claim (no duplicate detection cost)", async () => {
    const { id } = await submitGenuine();
    await drainBackground();
    await env.db.query("update public.submissions set redaction = null where id = $1", [id]);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: RedactionDeps = {
      ...liveRedactionDeps(env.storage),
      detect: async () => {
        calls++;
        await gate;
        return { faces_or_plates_present: false, regions: [] };
      },
    };
    const first = redactSubmission(env.db, id, slow);
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0));
    expect(await redactSubmission(env.db, id, slow)).toBe("skipped");
    release();
    expect(await first).toBe("done");
    expect(calls).toBe(3); // one per frame, from the first run only
  });
});
