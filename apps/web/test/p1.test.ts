/** P1: Protocol Studio draft/publish, Opportunity Radar, briefing video (mock Grok, PGlite). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO, ProtocolSchema, streetFloodDepth } from "@groundtruth/shared";
import { captureBackground, drainBackground } from "@/lib/background";
import { setContextFetch } from "@/lib/context/fetcher";
import { completeBriefingVideo } from "@/lib/briefing";
import { draftJsonSchema, parseDraft } from "@/lib/studio";
import { radarJsonSchema } from "@/lib/radar";
import { POST as devSession } from "@/app/api/dev/session/route";
import { POST as draft } from "@/app/api/protocols/draft/route";
import { POST as publish } from "@/app/api/protocols/[id]/publish/route";
import { POST as radar } from "@/app/api/radar/scan/route";
import { POST as briefing } from "@/app/api/bounties/[id]/briefing-video/route";
import { idCtx, req, setupTestEnv, type TestEnv } from "./helpers";

vi.mock("@/lib/grok/imagine", async (orig) => ({
  ...(await orig<typeof import("@/lib/grok/imagine")>()),
  grokVideoPoll: vi.fn(async () => ({ status: "done", url: "https://example.test/v.mp4" })),
}));

let env: TestEnv;
let researcher: string;
const noCtx = undefined as unknown;

beforeAll(async () => {
  vi.stubEnv("LOCAL_BACKEND", "1");
  vi.stubEnv("MOCK_GROK", "1");
  env = await setupTestEnv();
  captureBackground();
  setContextFetch(async () =>
    Response.json({ features: [{ geometry: null, properties: { id: "a1", event: "Flood Watch", severity: "Moderate" } }] }),
  );
  researcher = ((await (await devSession(req("POST", "/api/dev/session", { body: { role: "researcher" } }), noCtx)).json()) as { access_token: string }).access_token;
}, 60_000);
afterAll(async () => {
  setContextFetch(null);
  vi.unstubAllEnvs();
  await env.close();
});

describe("Protocol Studio", () => {
  it("draft schema is strict-mode friendly and round-trips a protocol", () => {
    const js = draftJsonSchema() as { additionalProperties?: boolean; properties: Record<string, unknown> };
    expect(js.additionalProperties).toBe(false);
    expect(js.properties.extraction_schema_json).toBeDefined();
    expect(js.properties.extraction_schema).toBeUndefined();
    const { extraction_schema, ...rest } = streetFloodDepth;
    expect(parseDraft({ ...rest, extraction_schema_json: JSON.stringify(extraction_schema) })).toEqual(streetFloodDepth);
    expect(() => parseDraft({ ...rest, extraction_schema_json: '{"type":"array"}' })).toThrow();
  });

  it("draft → publish creates a usable protocol version", async () => {
    const r = await draft(req("POST", "/api/protocols/draft", { token: researcher, body: { need: "photos of tomato leaves with spots, top and underside, coin for scale" } }), noCtx);
    expect(r.status).toBe(201);
    const d = (await r.json()) as { protocol_id: string; protocol: unknown };
    expect(ProtocolSchema.parse(d.protocol).slug).toBe("leaf-disease-scout");
    const p = await publish(req("POST", `/api/protocols/${d.protocol_id}/publish`, { token: researcher, body: {} }), idCtx(d.protocol_id));
    expect(((await p.json()) as { status: string }).status).toBe("published");
    const again = await publish(req("POST", `/api/protocols/${d.protocol_id}/publish`, { token: researcher, body: {} }), idCtx(d.protocol_id));
    expect(again.status).toBe(409);
    const r2 = await draft(req("POST", "/api/protocols/draft", { token: researcher, body: { need: "another leaf protocol please" } }), noCtx);
    expect(((await r2.json()) as { protocol: { version: number } }).protocol.version).toBe(2);
  });
});

describe("Opportunity Radar", () => {
  it("returns drafts for known protocols and counts alerts", async () => {
    expect((radarJsonSchema() as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    const r = await radar(req("POST", "/api/radar/scan", { token: researcher, body: { lat: DEMO.lat, lng: DEMO.lng } }), noCtx);
    const body = (await r.json()) as { drafts: { protocol_slug: string; alert_event: string | null }[]; alerts_considered: number };
    expect(body.alerts_considered).toBe(1);
    expect(body.drafts[0]).toMatchObject({ protocol_slug: "street-flood-depth", alert_event: "Flood Watch" });
  });
});

describe("briefing video", () => {
  it("starts, then stores the finished clip in the synthetic bucket and links it", async () => {
    const r = await briefing(req("POST", `/api/bounties/${DEMO.bountyId}/briefing-video`, { token: researcher }), idCtx(DEMO.bountyId));
    expect(r.status).toBe(202);
    expect(((await r.json()) as { status: string }).status).toBe("pending");
    const out = await completeBriefingVideo(env.db, env.storage, {
      bountyId: DEMO.bountyId,
      requestId: "x",
      prompt: "p",
      fetchImpl: async () => new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])),
    });
    expect(out).toBe("stored");
    const row = await env.db.query<{ briefing_video_path: string }>("select briefing_video_path from public.bounties where id = $1", [DEMO.bountyId]);
    expect(row[0]!.briefing_video_path).toBe(`synthetic/briefings/${DEMO.bountyId}.mp4`);
    expect(await env.storage.exists(`synthetic/briefings/${DEMO.bountyId}.mp4`)).toBe(true);
    // the route's own background task tries the (unreachable) mock URL; it must fail quietly
    await drainBackground();
  });
});
