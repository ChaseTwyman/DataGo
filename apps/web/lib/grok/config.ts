/** Grok configuration. Every model name comes from env (BUILD_PROMPT §9). Server-only. */

export const grokEnv = {
  get apiKey() {
    return process.env.XAI_API_KEY ?? "";
  },
  get baseURL() {
    return process.env.XAI_BASE_URL || "https://api.x.ai/v1";
  },
  get reasoningModel() {
    return process.env.GROK_REASONING_MODEL || "grok-4.7";
  },
  get fastVisionModel() {
    return process.env.GROK_FAST_VISION_MODEL || "grok-4.20-non-reasoning";
  },
  get imageModel() {
    return process.env.GROK_IMAGE_MODEL || "grok-imagine-image-2.0";
  },
  get videoModel() {
    return process.env.GROK_VIDEO_MODEL || "grok-imagine-video-1.5";
  },
  /**
   * reasoning_effort for the grok-4.7 verification call. xAI default is "high" (~90 s for three
   * frames from Vercel); "medium" keeps reasoning for the skeptical audit at lower latency.
   */
  get verificationEffort(): "low" | "medium" | "high" | "xhigh" {
    const v = process.env.GROK_VERIFICATION_EFFORT;
    return v === "low" || v === "high" || v === "xhigh" ? v : "medium";
  },
  get voiceModel() {
    return process.env.GROK_VOICE_MODEL || "grok-voice-latest";
  },
};

/** MOCK_GROK=1 returns deterministic fixtures for every Grok call; no key needed. */
export function isMockGrok(): boolean {
  return process.env.MOCK_GROK === "1" || process.env.MOCK_GROK === "true";
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";
}

export class GrokError extends Error {
  constructor(
    message: string,
    readonly op: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GrokError";
  }
}

export function requireKey(op: string): string {
  const key = grokEnv.apiKey;
  if (!key) throw new GrokError("XAI_API_KEY is not set (or set MOCK_GROK=1)", op);
  return key;
}
