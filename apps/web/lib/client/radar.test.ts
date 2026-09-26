import { describe, expect, it } from "vitest";
import type { DraftBounty } from "@groundtruth/shared";
import { ApiClientError, errorMessage } from "./errors";
import {
  clearRadarJob,
  draftPrefillHref,
  getRadarJob,
  parseBountyPrefill,
  pickProtocolId,
  radarErrorMessage,
  radarStage,
  safeSourceLinks,
  startRadarJob,
  zoomForRadiusM,
} from "./radar";

const draft: DraftBounty = {
  title: "Flood depth after the Peachtree Creek watch",
  summary: "Water pooled on low streets overnight. Readings calibrate the flood model.",
  protocol_slug: "street-flood-depth",
  center_lat: 33.7765,
  center_lng: -84.3963,
  radius_m: 1200,
  rationale: "NWS Flood Watch plus X posts about flooded underpasses.",
  sources: ["https://x.com/a/status/1"],
  alert_event: "Flood Watch",
};

describe("draft → New bounty prefill", () => {
  it("round-trips a draft through the URL", () => {
    const href = draftPrefillHref(draft);
    expect(href.startsWith("/bounties/new?")).toBe(true);
    const p = parseBountyPrefill(href.slice(href.indexOf("?")));
    expect(p).toEqual({
      title: draft.title,
      summary: draft.summary,
      center: { lat: 33.7765, lng: -84.3963 },
      radiusM: 1200,
      protocolSlug: "street-flood-depth",
      protocolId: null,
      source: "radar",
      alertEvent: "Flood Watch",
    });
  });

  it("clamps the radius to the form's slider and snaps to its 50 m step", () => {
    const tiny = parseBountyPrefill(draftPrefillHref({ ...draft, radius_m: 20 }).split("?")[1]!);
    const huge = parseBountyPrefill(draftPrefillHref({ ...draft, radius_m: 90_000 }).split("?")[1]!);
    const odd = parseBountyPrefill(draftPrefillHref({ ...draft, radius_m: 1234 }).split("?")[1]!);
    expect([tiny?.radiusM, huge?.radiusM, odd?.radiusM]).toEqual([100, 5000, 1250]);
  });

  it("trims long text to the create-bounty limits", () => {
    const p = parseBountyPrefill(draftPrefillHref({ ...draft, title: "t".repeat(300), summary: "s".repeat(900) }).split("?")[1]!);
    expect(p?.title).toHaveLength(120);
    expect(p?.summary).toHaveLength(500);
  });

  it("drops an out-of-range or missing center instead of trusting it", () => {
    expect(parseBountyPrefill("?source=radar&title=x&lat=123&lng=10")?.center).toBeNull();
    expect(parseBountyPrefill("?source=radar&title=x&lat=abc&lng=10")?.center).toBeNull();
    expect(parseBountyPrefill("?source=radar&title=x")?.radiusM).toBeNull();
  });

  it("keeps Protocol Studio's ?protocol=<id> link working as a plain manual prefill", () => {
    expect(parseBountyPrefill("?protocol=abc")).toEqual({
      title: null,
      summary: null,
      center: null,
      radiusM: null,
      protocolSlug: null,
      protocolId: "abc",
      source: "manual",
      alertEvent: null,
    });
    expect(parseBountyPrefill("")).toBeNull();
    expect(parseBountyPrefill("?foo=bar")).toBeNull();
  });
});

describe("pickProtocolId", () => {
  const list = [
    { id: "a", slug: "street-flood-depth", version: 1, status: "published" },
    { id: "b", slug: "street-flood-depth", version: 2, status: "published" },
    { id: "c", slug: "street-flood-depth", version: 3, status: "draft" },
    { id: "d", slug: "leaf-spots", version: 1, status: "published" },
  ];
  it("prefers the explicit id, then the newest published version of the slug, then the first", () => {
    expect(pickProtocolId(list, { protocolId: "d", protocolSlug: null })).toBe("d");
    expect(pickProtocolId(list, { protocolId: null, protocolSlug: "street-flood-depth" })).toBe("b");
    expect(pickProtocolId(list, { protocolId: "c", protocolSlug: null })).toBe("a");
    expect(pickProtocolId(list, { protocolId: null, protocolSlug: "unknown" })).toBe("a");
    expect(pickProtocolId([], { protocolId: null, protocolSlug: null })).toBe("");
  });
});

describe("source links", () => {
  it("keeps only http(s) URLs (model output is untrusted) and labels them by host", () => {
    expect(safeSourceLinks(["https://www.weather.gov/x", "javascript:alert(1)", "x.com/foo", "http://news.example.org/a", "https://www.weather.gov/x"])).toEqual([
      { href: "https://www.weather.gov/x", label: "weather.gov" },
      { href: "http://news.example.org/a", label: "news.example.org" },
    ]);
  });
});

describe("radar errors and progress", () => {
  it("explains a gateway timeout as a too-long scan, and otherwise uses the shared copy", () => {
    expect(radarErrorMessage(new ApiClientError("504", 504, "http_error"))).toMatch(/took too long/);
    const busy = new ApiClientError("x", 502, "GROK_UNAVAILABLE");
    expect(radarErrorMessage(busy)).toBe(errorMessage(busy));
    const limited = new ApiClientError("x", 429, "RATE_LIMITED");
    expect(radarErrorMessage(limited)).toBe(errorMessage(limited));
  });

  it("walks through progress stages", () => {
    expect(radarStage(1_000)).toMatch(/weather service alerts/i);
    expect(radarStage(300_000)).toMatch(/still/i);
  });

  it("zooms out for wider areas", () => {
    expect(zoomForRadiusM(1_000)).toBeGreaterThan(zoomForRadiusM(50_000));
    expect(zoomForRadiusM(300_000)).toBeGreaterThanOrEqual(3);
  });
});

describe("radar job store", () => {
  it("runs one scan at a time and keeps the result for when the page is reopened", async () => {
    let resolve!: (v: { drafts: DraftBounty[]; alerts_considered: number }) => void;
    const run = () => new Promise<{ drafts: DraftBounty[]; alerts_considered: number }>((r) => (resolve = r));
    const req = { lat: 33.7, lng: -84.4, radius_km: 25 };
    expect(startRadarJob(req, run, errorMessage)).toBe(true);
    expect(startRadarJob(req, run, errorMessage)).toBe(false);
    expect(getRadarJob().status).toBe("running");
    resolve({ drafts: [draft], alerts_considered: 1 });
    await Promise.resolve();
    const j = getRadarJob();
    expect(j.status).toBe("done");
    if (j.status === "done") expect(j.result.drafts).toHaveLength(1);
    clearRadarJob();
    expect(getRadarJob().status).toBe("idle");
  });

  it("turns a failure into user copy", async () => {
    startRadarJob({ lat: 1, lng: 1, radius_km: 5 }, () => Promise.reject(new ApiClientError("x", 502, "GROK_UNAVAILABLE")), radarErrorMessage);
    await new Promise((r) => setTimeout(r, 0));
    const j = getRadarJob();
    expect(j.status).toBe("error");
    if (j.status === "error") expect(j.message).toBe(errorMessage(new ApiClientError("x", 502, "GROK_UNAVAILABLE")));
    clearRadarJob();
  });
});
