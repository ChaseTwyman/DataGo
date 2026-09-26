/** Grok Imagine: images (examples, red-team fakes) and videos (briefing clips). */
import { grokFetch } from "./client";
import { grokEnv, GrokError, isMockGrok } from "./config";
import { logGrokCall } from "./log";
import { mockImage } from "./mocks/image";

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";

interface ImageResponse {
  data: { b64_json?: string; url?: string }[];
  usage?: Record<string, number>;
}

/** Returns image bytes. Hosted URLs are temporary, so callers store the bytes in Supabase Storage. */
export async function grokImage(args: { prompt: string; aspectRatio?: AspectRatio }): Promise<Buffer> {
  const model = grokEnv.imageModel;
  const t0 = Date.now();
  if (isMockGrok()) {
    const [w, h] = args.aspectRatio === "3:4" ? [480, 640] : args.aspectRatio === "9:16" ? [360, 640] : [640, 360];
    const buf = await mockImage(args.prompt, w, h);
    logGrokCall({ op: "image", model, ms: Date.now() - t0, ok: true, mock: true });
    return buf;
  }
  try {
    const res = await grokFetch<ImageResponse>("/images/generations", {
      op: "image",
      timeoutMs: 120_000,
      body: { model, prompt: args.prompt, aspect_ratio: args.aspectRatio ?? "16:9", response_format: "b64_json", n: 1 },
    });
    const b64 = res.data[0]?.b64_json;
    if (!b64) throw new Error("no b64_json in image response");
    logGrokCall({ op: "image", model, ms: Date.now() - t0, ok: true, mock: false, usage: res.usage ?? null });
    return Buffer.from(b64, "base64");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logGrokCall({ op: "image", model, ms: Date.now() - t0, ok: false, mock: false, error: msg });
    throw new GrokError(`image generation failed: ${msg}`, "image", err);
  }
}

export interface VideoStart {
  requestId: string;
}
export type VideoPoll =
  | { status: "pending" }
  | { status: "done"; url: string | null }
  | { status: "failed" | "expired"; error?: string };

export async function grokVideoStart(args: {
  prompt: string;
  duration?: number;
  aspectRatio?: "9:16" | "16:9";
  resolution?: "480p" | "720p";
}): Promise<VideoStart> {
  const model = grokEnv.videoModel;
  const t0 = Date.now();
  if (isMockGrok()) {
    logGrokCall({ op: "video_start", model, ms: 0, ok: true, mock: true });
    return { requestId: `mock-video-${args.prompt.length}` };
  }
  const duration = Math.min(15, Math.max(1, Math.round(args.duration ?? 7)));
  const res = await grokFetch<{ request_id: string }>("/videos/generations", {
    op: "video_start",
    body: { model, prompt: args.prompt, duration, aspect_ratio: args.aspectRatio ?? "9:16", resolution: args.resolution ?? "720p" },
  });
  logGrokCall({ op: "video_start", model, ms: Date.now() - t0, ok: true, mock: false });
  return { requestId: res.request_id };
}

export async function grokVideoPoll(requestId: string): Promise<VideoPoll> {
  if (isMockGrok()) return { status: "done", url: null };
  const res = await grokFetch<{ status: string; video?: { url?: string }; error?: string }>(
    `/videos/${encodeURIComponent(requestId)}`,
    { op: "video_poll", method: "GET" },
  );
  if (res.status === "done") return { status: "done", url: res.video?.url ?? null };
  if (res.status === "failed" || res.status === "expired") return { status: res.status, error: res.error };
  return { status: "pending" };
}
