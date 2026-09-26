import { describe, expect, it } from "vitest";
import { streetFloodDepth, type Protocol } from "@groundtruth/shared";
import { ApiClientError, errorMessage } from "./errors";
import { allowedWithoutResearcher } from "./access";
import {
  clearDraftJob,
  draftStage,
  extractionFields,
  getDraftJob,
  parseProtocolJson,
  startDraftJob,
  withExtractionFields,
} from "./studio";

const flood = streetFloodDepth as Protocol;

describe("extraction field editing", () => {
  it("reads the JSON Schema properties as rows", () => {
    const rows = extractionFields(flood);
    expect(rows.find((r) => r.name === "depth_cm")).toMatchObject({ type: "number|null", required: true });
    expect(rows.find((r) => r.name === "depth_confidence")?.type).toBe("number");
  });

  it("round-trips unchanged rows without losing enum/min/max keys", () => {
    expect(withExtractionFields(flood, extractionFields(flood)).extraction_schema).toEqual({
      ...flood.extraction_schema,
      required: extractionFields(flood).filter((r) => r.required).map((r) => r.name),
    });
    const surface = withExtractionFields(flood, extractionFields(flood)).extraction_schema.properties.surface_type;
    expect(surface?.enum).toBeDefined();
  });

  it("adds, retypes and drops fields; unnamed rows are not written", () => {
    const rows = extractionFields(flood).filter((r) => r.name !== "surface_type");
    rows.push({ name: "water_color", type: "string", description: "Colour of the water", required: true }, { name: " ", type: "number", description: "", required: false });
    const p = withExtractionFields(flood, rows);
    expect(p.extraction_schema.properties.surface_type).toBeUndefined();
    expect(p.extraction_schema.properties.water_color).toEqual({ type: "string", description: "Colour of the water" });
    expect(p.extraction_schema.required).toContain("water_color");
    expect(Object.keys(p.extraction_schema.properties)).not.toContain(" ");
  });
});

describe("raw JSON editor", () => {
  it("accepts a valid protocol", () => {
    const r = parseProtocolJson(JSON.stringify(flood));
    expect(r.ok).toBe(true);
  });

  it("explains broken JSON and schema failures in words, not zod dumps", () => {
    const bad = parseProtocolJson("{ nope");
    expect(bad).toEqual({ ok: false, lines: [expect.stringMatching(/isn't valid JSON/)] });
    const broken = { ...flood, name: "", capture: { ...flood.capture, required_elements: [{ id: "Bad Id", label: "x", description: "y" }] } };
    const r = parseProtocolJson(JSON.stringify(broken));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lines).toContain("Name is required.");
    expect(r.lines.some((l) => l.startsWith("Capture › required elements › #1 › id must be lowercase"))).toBe(true);
    expect(r.lines.join(" ")).not.toMatch(/invalid_|too_small|\{|\[/);
  });
});

describe("draft job", () => {
  it("runs once at a time and keeps the result for when the page comes back", async () => {
    let resolve!: (v: { protocol_id: string; protocol: Protocol }) => void;
    const run = () => new Promise<{ protocol_id: string; protocol: Protocol }>((r) => (resolve = r));
    expect(startDraftJob("Measure puddles on campus", run, () => "x")).toBe(true);
    expect(getDraftJob().status).toBe("running");
    expect(startDraftJob("another", run, () => "x")).toBe(false);
    clearDraftJob(); // no-op while running
    expect(getDraftJob().status).toBe("running");
    resolve({ protocol_id: "p1", protocol: flood });
    await Promise.resolve();
    await Promise.resolve();
    expect(getDraftJob()).toMatchObject({ status: "done", protocolId: "p1" });
    clearDraftJob();
    expect(getDraftJob().status).toBe("idle");
  });

  it("errors become the caller's friendly copy", async () => {
    startDraftJob("Measure puddles on campus", () => Promise.reject(new ApiClientError("x", 429, "RATE_LIMITED")), errorMessage);
    await Promise.resolve();
    await Promise.resolve();
    const j = getDraftJob();
    expect(j.status).toBe("error");
    if (j.status === "error") expect(j.message).toMatch(/wait a while/);
    clearDraftJob();
  });

  it("progress copy advances with time", () => {
    expect(draftStage(1000)).not.toBe(draftStage(60_000));
  });
});

describe("account error copy and gating", () => {
  it("maps account error codes to human text", () => {
    for (const code of ["EMAIL_TAKEN", "ACCOUNT_REQUIRED", "ACCOUNT_SUSPENDED", "RESEARCHER_REQUIRED", "ADMIN_REQUIRED", "RATE_LIMITED", "RESEARCHER_REVOKED", "CANNOT_CHANGE_SELF", "INVALID_CREDENTIALS"]) {
      const m = errorMessage(new ApiClientError("raw server text", 400, code));
      expect(m).not.toBe("raw server text");
      expect(m).not.toMatch(/That request wasn't accepted/);
    }
  });

  it("non-researchers may open only Account (and Admin if admin)", () => {
    expect(allowedWithoutResearcher("/account", false)).toBe(true);
    expect(allowedWithoutResearcher("/bounties", false)).toBe(false);
    expect(allowedWithoutResearcher("/admin/users", false)).toBe(false);
    expect(allowedWithoutResearcher("/admin/users", true)).toBe(true);
    expect(allowedWithoutResearcher("/accountx", false)).toBe(false);
  });
});
