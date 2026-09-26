/**
 * Impact cards: privacy of what is drawn (whitelisted facts only), no metadata in the image, never the
 * raw photo, owner-only, accepted-only, cached, AI background pooled/capped/labelled.
 */
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateSessionResponseSchema, DEMO, ImpactCardResponseSchema, streetFloodDepth } from "@groundtruth/shared";
import { captureBackground, drainBackground } from "@/lib/background";
import { setContextFetch } from "@/lib/context/fetcher";
import { clearHazardCache } from "@/lib/hazards";
import { AI_LABEL, cardLines, cardSafe, cardSvg, composeCard, impactFacts, VERIFIED_LINE } from "@/lib/impact/card";
import { impactCard } from "@/lib/impact/service";
import { POST as createSession } from "@/app/api/capture/sessions/route";
import { POST as createSubmission } from "@/app/api/submissions/route";
import { PUT as devUpload } from "@/app/api/dev/upload/route";
import { POST as impactRoute } from "@/app/api/me/submissions/[id]/impact-card/route";
import { idCtx, newContributor, passGate, randomJpeg, req, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
const noCtx = undefined as unknown;

beforeAll(async () => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  vi.stubEnv("DEMO_MODE", "1");
  env = await setupTestEnv();
  captureBackground();
  setContextFetch(async () => Response.json({ features: [] }));
}, 60_000);
afterAll(async () => {
  setContextFetch(null);
  vi.unstubAllEnvs();
  await env.close();
});
beforeEach(() => clearHazardCache());

/** A real accepted submission through the routes; `gate=false` → needs_review. */
async function captured(token: string, gate = true): Promise<string> {
  const r = await createSession(
    req("POST", "/api/capture/sessions", { token, body: { bounty_id: DEMO.bountyId, lat: DEMO.lat, lng: DEMO.lng, accuracy_m: 5 } }),
    noCtx,
  );
  const s = CreateSessionResponseSchema.parse(await r.json());
  if (gate) await passGate(token, s.session_id);
  for (const u of s.uploads) {
    const url = new URL(u.signed_url);
    await devUpload(req("PUT", url.pathname + url.search, { raw: await randomJpeg() }), noCtx);
  }
  const at = new Date().toISOString();
  const sub = await createSubmission(
    req("POST", "/api/submissions", {
      token,
      body: {
        session_id: s.session_id,
        nonce: s.nonce,
        media: s.uploads.map((u) => ({ path: u.path, width: 640, height: 480, captured_at: at })),
        lat: DEMO.lat,
        lng: DEMO.lng,
        accuracy_m: 5,
        captured_at: at,
        device: { model: "iPhone 16", os: "ios", os_version: "26.0", app_version: "0.1.0" },
        sensors: { tilt_deg: 3, rotation_rate: 0.1, steady: true },
        field_notes: { water_state: "still", debris_present: false },
        gate: { degraded: false, frame_checks: 2, consecutive_green: 2, last_hint: null },
      },
    }),
    noCtx,
  );
  const { submission_id } = (await sub.json()) as { submission_id: string };
  await drainBackground();
  return submission_id;
}

const FACT_INPUT = {
  protocol: streetFloodDepth,
  extracted: { depth_cm: 12, reference_object: "curb at 123 Peachtree St" },
  fieldNotes: { water_state: "still", debris_present: true, notes: "outside Jane Doe's house <script>" } as Record<string, unknown>,
  h3Cell: "8944c1a8c2bffff",
  capturedAt: "2026-09-26T14:37:12.000Z",
};

describe("impact card content (privacy by construction)", () => {
  it("draws only the reading, an enum note, protocol name, coarse area and the day", () => {
    const f = impactFacts(FACT_INPUT as Parameters<typeof impactFacts>[0]);
    expect(f.headline).toBe("12 CM");
    expect(f.qualifier).toBe("STILL WATER");
    expect(f.protocol).toBe("STREET FLOOD DEPTH");
    expect(f.area).toMatch(/^\d+\.\d°[NS] \d+\.\d°[EW]$/);
    expect(f.date).toBe("SEP 26 2026");
    const all = cardLines(f, true).join(" | ");
    // no free text, no time of day, no precise coordinates
    expect(all).not.toMatch(/PEACHTREE|JANE|SCRIPT|14:37|33\.77|84\.39/);
    expect(cardLines(f, false)).toContain(VERIFIED_LINE);
    expect(cardLines(f, true)).toContain(AI_LABEL);
    expect(cardLines(f, false)).not.toContain(AI_LABEL);
  });

  it("enum notes must be one of the protocol's options (nothing else reaches the card)", () => {
    const f = impactFacts({ ...(FACT_INPUT as Parameters<typeof impactFacts>[0]), fieldNotes: { water_state: "123 Main St" } });
    expect(f.qualifier).toBeNull();
    expect(cardSafe('a<b>"c')).toBe("A B C");
  });

  it("the SVG is vector paths only (no <text>, no images, no ids)", () => {
    const svg = cardSvg(impactFacts(FACT_INPUT as Parameters<typeof impactFacts>[0]), true);
    expect(svg).not.toMatch(/<text|<image|href|xlink|script/i);
  });

  it("the composed image is a 1080×1350 JPEG with no EXIF/XMP/IPTC metadata", async () => {
    const f = impactFacts(FACT_INPUT as Parameters<typeof impactFacts>[0]);
    for (const bg of [null, await randomJpeg(800, 600)]) {
      const img = await composeCard(f, bg);
      const m = await sharp(img).metadata();
      expect(m.format).toBe("jpeg");
      expect([m.width, m.height]).toEqual([1080, 1350]);
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.iptc).toBeUndefined();
    }
  });
});

describe("POST /api/me/submissions/:id/impact-card", () => {
  it("owner of an accepted observation gets a card URL in the synthetic bucket; it is cached; the photo is never read", async () => {
    const a = await newContributor(env.db);
    const id = await captured(a.token);
    const reads: string[] = [];
    const get = env.storage.get.bind(env.storage);
    const spy = vi.spyOn(env.storage, "get").mockImplementation(async (p: string) => {
      reads.push(p);
      return get(p);
    });
    try {
      const r = await impactRoute(req("POST", `/api/me/submissions/${id}/impact-card`, { token: a.token, body: {} }), idCtx(id));
      expect(r.status).toBe(200);
      const body = ImpactCardResponseSchema.parse(await r.json());
      expect(body).toMatchObject({ ai_background: false, cached: false, note: null });
      expect(decodeURIComponent(body.url)).toContain(`synthetic/impact/${id}.jpg`);
      const again = ImpactCardResponseSchema.parse(await (await impactRoute(req("POST", `/api/me/submissions/${id}/impact-card`, { token: a.token, body: {} }), idCtx(id))).json());
      expect(again.cached).toBe(true);
      expect(reads.filter((p) => p.startsWith("observations/"))).toEqual([]);
      const card = await env.storage.get(`synthetic/impact/${id}.jpg`);
      expect((await sharp(card).metadata()).exif).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("other users get 404; not-yet-accepted observations get 409", async () => {
    const a = await newContributor(env.db);
    const b = await newContributor(env.db);
    const id = await captured(a.token);
    expect((await impactRoute(req("POST", `/api/me/submissions/${id}/impact-card`, { token: b.token, body: {} }), idCtx(id))).status).toBe(404);
    const review = await captured(a.token, false);
    const r = await impactRoute(req("POST", `/api/me/submissions/${review}/impact-card`, { token: a.token, body: {} }), idCtx(review));
    expect(r.status).toBe(409);
  });

  it("AI background: pooled (one generation reused), labelled, capped per day, and falls back to plain on failure", async () => {
    const a = await newContributor(env.db);
    const ids = [await captured(a.token), await captured(a.token)];
    let calls = 0;
    const gen = async () => {
      calls++;
      return randomJpeg(768, 1024);
    };
    const first = await impactCard(env.db, env.storage, a.id, ids[0]!, { ai: true }, { generateBackground: gen });
    expect(first).toMatchObject({ ai_background: true, note: null });
    expect(first.path).toBe(`synthetic/impact/${ids[0]}-ai.jpg`);
    const rows = await env.db.query<{ kind: string; prompt: string }>("select kind, prompt from public.synthetic_media where kind = 'impact'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prompt).not.toContain(ids[0]!);

    // the pooled background is reused: a second card for the same submission slot costs no call
    await env.db.query("delete from public.impact_cards");
    await impactCard(env.db, env.storage, a.id, ids[0]!, { ai: true }, { generateBackground: gen });
    expect(calls).toBe(1);

    // cap reached (1 generation today, cap 1) → plain card with a note, no generation
    vi.stubEnv("IMPACT_AI_DAILY_CAP", "1");
    for (let s = 0; s < 4; s++) await env.storage.remove([`synthetic/impact/backgrounds/${s}.jpg`]);
    const capped = await impactCard(env.db, env.storage, a.id, ids[1]!, { ai: true }, { generateBackground: gen });
    expect(calls).toBe(1);
    expect(capped).toMatchObject({ ai_background: false });
    expect(capped.note).toMatch(/limit/);
    vi.stubEnv("IMPACT_AI_DAILY_CAP", "10");

    // generation failure → plain card, never an error
    await env.db.query("delete from public.impact_cards");
    for (let s = 0; s < 4; s++) await env.storage.remove([`synthetic/impact/backgrounds/${s}.jpg`]);
    const failed = await impactCard(env.db, env.storage, a.id, ids[1]!, { ai: true }, { generateBackground: async () => Promise.reject(new Error("imagine down")) });
    expect(failed).toMatchObject({ ai_background: false });
    expect(failed.note).toMatch(/isn't available/);
  });
});
