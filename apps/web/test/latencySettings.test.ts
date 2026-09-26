/** Verification latency knobs: env parsing, per-frame detail, and abort plumbing. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { streetFloodDepth } from "@groundtruth/shared";
import { grokEnv } from "@/lib/grok/config";
import { grokJSON } from "@/lib/grok/json";
import { verificationFrameDetails } from "@/lib/grok/vision";
import { modelAccessor } from "@/lib/verification/stages/modelVerification";
import { randomJpeg } from "./helpers";

afterEach(() => vi.unstubAllEnvs());

describe("verification settings", () => {
  it("defaults keep the audited configuration (medium, 1536 px, high detail, 150 s)", () => {
    vi.stubEnv("GROK_VERIFICATION_EFFORT", "");
    vi.stubEnv("VERIFICATION_FRAME_MAX_EDGE", "");
    vi.stubEnv("VERIFICATION_IMAGE_DETAIL", "");
    vi.stubEnv("GROK_VERIFICATION_TIMEOUT_MS", "");
    expect(grokEnv.verificationEffort).toBe("medium");
    expect(grokEnv.verificationFrameMaxEdge).toBe(1536);
    expect(grokEnv.verificationImageDetail).toBe("high");
    expect(grokEnv.verificationTimeoutMs).toBe(150_000);
  });

  it("env overrides are validated and clamped to safe ranges", () => {
    vi.stubEnv("VERIFICATION_FRAME_MAX_EDGE", "1024");
    vi.stubEnv("VERIFICATION_IMAGE_DETAIL", "mixed");
    vi.stubEnv("GROK_VERIFICATION_TIMEOUT_MS", "90000");
    expect(grokEnv.verificationFrameMaxEdge).toBe(1024);
    expect(grokEnv.verificationImageDetail).toBe("mixed");
    expect(grokEnv.verificationTimeoutMs).toBe(90_000);
    vi.stubEnv("VERIFICATION_FRAME_MAX_EDGE", "64");
    vi.stubEnv("GROK_VERIFICATION_TIMEOUT_MS", "999999");
    vi.stubEnv("VERIFICATION_IMAGE_DETAIL", "ultra");
    expect(grokEnv.verificationFrameMaxEdge).toBe(1536);
    expect(grokEnv.verificationTimeoutMs).toBe(150_000);
    expect(grokEnv.verificationImageDetail).toBe("high");
  });

  it("mixed detail keeps the first and last frame (the parallax pair) at high", () => {
    expect(verificationFrameDetails(3, "mixed")).toEqual(["high", "low", "high"]);
    expect(verificationFrameDetails(3, "high")).toEqual(["high", "high", "high"]);
    expect(verificationFrameDetails(2, "low")).toEqual(["low", "low"]);
  });
});

describe("abort plumbing", () => {
  it("grokJSON refuses an already-aborted call (mock mode too)", async () => {
    vi.stubEnv("MOCK_GROK", "1");
    const c = new AbortController();
    c.abort("off-topic");
    await expect(
      grokJSON({ op: "t", model: "m", system: "s", content: [], schema: {}, name: "t", parse: (x) => x, signal: c.signal, mock: () => 1 }),
    ).rejects.toThrow(/aborted/);
  });

  it("modelAccessor passes its signal to verify() and abort() cancels it", async () => {
    let seen: AbortSignal | undefined;
    const bytes = await randomJpeg(320, 240);
    const acc = modelAccessor(
      {
        frames: [{ path: "observations/u/s/0.jpg", bytes }],
        protocol: streetFloodDepth,
        challenge: streetFloodDepth.capture.challenges[0]!,
      } as never,
      {
        verify: (a: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            seen = a.signal;
            a.signal!.addEventListener("abort", () => reject(new Error(String(a.signal!.reason))));
          }),
      } as never,
    );
    const p = acc();
    await vi.waitFor(() => expect(seen).toBeDefined());
    acc.abort("off-topic");
    await expect(p).rejects.toThrow(/off-topic/);
    expect(seen!.aborted).toBe(true);
    expect(acc()).toBe(p); // memoised: never re-issued after an abort
  });
});
