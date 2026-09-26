import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { frameCheckZod, isFrameAllGreen, parseVerification, streetFloodDepth } from "@groundtruth/shared";

const create = vi.fn();
vi.mock("@/lib/grok/client", () => ({
  grokClient: () => ({ responses: { create } }),
  grokFetch: vi.fn(),
}));

import { grokJSON } from "@/lib/grok/json";
import { setGrokLogSink, type GrokCallLog } from "@/lib/grok/log";
import { frameCheck, verifyCapture } from "@/lib/grok/vision";
import { grokImage } from "@/lib/grok/imagine";
import { mintVoiceToken, parseClientSecret } from "@/lib/grok/voiceToken";

let logs: GrokCallLog[] = [];
beforeEach(() => {
  logs = [];
  setGrokLogSink((e) => logs.push(e));
  create.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mock mode", () => {
  beforeEach(() => vi.stubEnv("MOCK_GROK", "1"));

  it("frame check default is all green and schema-valid", async () => {
    const r = await frameCheck({ protocol: streetFloodDepth, imageBase64: "x" });
    expect(frameCheckZod(streetFloodDepth).parse(r)).toEqual(r);
    expect(isFrameAllGreen(streetFloodDepth, r)).toBe(true);
    expect(logs[0]).toMatchObject({ op: "frame_check", mock: true, ok: true, model: "grok-4.20-non-reasoning" });
    expect(create).not.toHaveBeenCalled();
  });

  it("screen_recapture variant flags the screen", async () => {
    const r = await frameCheck({ protocol: streetFloodDepth, imageBase64: "x", variant: "screen_recapture" });
    expect(r.suspected_screen_or_print.value).toBe(true);
    expect(isFrameAllGreen(streetFloodDepth, r)).toBe(false);
  });

  it("missing_element variant hides the waterline", async () => {
    const r = await frameCheck({ protocol: streetFloodDepth, imageBase64: "x", variant: "missing_element" });
    expect(r.elements.find((e) => e.id === "waterline")?.visible).toBe(false);
  });

  it("verification fixtures satisfy the protocol extraction schema", async () => {
    const challenge = streetFloodDepth.capture.challenges[0]!;
    const v = await verifyCapture({ protocol: streetFloodDepth, challenge, framesBase64: ["a", "b", "c"], intervalMs: 600 });
    expect(parseVerification(streetFloodDepth, v).extraction.depth_cm).toBe(12);
    const fake = await verifyCapture({
      protocol: streetFloodDepth,
      challenge,
      framesBase64: ["a"],
      intervalMs: 600,
      variant: "ai_generated",
    });
    expect(fake.authenticity.ai_generated.suspected).toBe(true);
  });

  it("image mock is deterministic per prompt and differs across prompts", async () => {
    const a = await grokImage({ prompt: "flood A" });
    const a2 = await grokImage({ prompt: "flood A" });
    const b = await grokImage({ prompt: "flood B" });
    expect(a.equals(a2)).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(0, 2).toString("hex")).toBe("ffd8"); // JPEG
  });

  it("voice token mock needs no key", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const t = await mintVoiceToken();
    expect(t.token).toBe("mock-ephemeral-token");
    expect(t.url).toBe("wss://api.x.ai/v1/realtime?model=grok-voice-latest");
  });

  it("model names come from env", async () => {
    vi.stubEnv("GROK_FAST_VISION_MODEL", "custom-fast");
    await frameCheck({ protocol: streetFloodDepth, imageBase64: "x" });
    expect(logs.at(-1)?.model).toBe("custom-fast");
  });
});

describe("real path (stubbed SDK)", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_GROK", "0");
    vi.stubEnv("XAI_API_KEY", "test-key");
  });

  const args = {
    op: "t",
    model: "m",
    system: "s",
    content: [{ type: "input_text" as const, text: "hi" }],
    schema: { type: "object" },
    name: "t",
    parse: (raw: unknown) => {
      const r = raw as { ok?: boolean };
      if (r.ok !== true) throw Object.assign(new Error("bad"), { issues: [] });
      return r;
    },
    mock: () => ({ ok: true }),
  };

  it("sends store:false and a strict json_schema, logs usage", async () => {
    create.mockResolvedValueOnce({ output_text: '{"ok":true}', usage: { input_tokens: 10, output_tokens: 3 } });
    await expect(grokJSON(args)).resolves.toEqual({ ok: true });
    const body = create.mock.calls[0]![0];
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "t", strict: true });
    expect(logs[0]).toMatchObject({ ok: true, mock: false, usage: { input_tokens: 10, output_tokens: 3 } });
  });

  it("verification: one attempt, 150 s budget, no SDK retry", async () => {
    create.mockResolvedValueOnce({ output_text: "{}" });
    const challenge = streetFloodDepth.capture.challenges[0]!;
    await verifyCapture({ protocol: streetFloodDepth, challenge, framesBase64: ["a"], intervalMs: 600 }).catch(() => undefined);
    expect(create.mock.calls[0]![1]).toEqual({ timeout: 150_000, maxRetries: 0 });
  });

  it("frame check: 8 s budget, no SDK retry", async () => {
    create.mockResolvedValueOnce({ output_text: "{}" });
    await frameCheck({ protocol: streetFloodDepth, imageBase64: "x" }).catch(() => undefined);
    expect(create.mock.calls[0]![1]).toEqual({ timeout: 8_000, maxRetries: 0 });
  });

  it("retries once on invalid JSON, then succeeds", async () => {
    create.mockResolvedValueOnce({ output_text: "not json" }).mockResolvedValueOnce({ output_text: '{"ok":true}' });
    await expect(grokJSON(args)).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("gives up after two validation failures", async () => {
    create.mockResolvedValue({ output_text: '{"ok":false}' });
    await expect(grokJSON(args)).rejects.toThrow(/t failed/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry network errors", async () => {
    create.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(grokJSON(args)).rejects.toThrow(/ECONNRESET/);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("parseClientSecret", () => {
  it("accepts top-level value with unix seconds", () => {
    expect(parseClientSecret({ value: "ek_1", expires_at: 1_790_000_000 })).toEqual({
      token: "ek_1",
      expiresAt: new Date(1_790_000_000_000).toISOString(),
    });
  });
  it("accepts nested client_secret", () => {
    expect(parseClientSecret({ client_secret: { value: "ek_2" } }, 0).token).toBe("ek_2");
  });
  it("rejects bodies without a token", () => {
    expect(() => parseClientSecret({})).toThrow();
  });
});
