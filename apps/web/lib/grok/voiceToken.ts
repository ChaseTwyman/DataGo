/** Ephemeral realtime voice tokens. The phone connects to xAI directly with these; never the API key. */
import { grokFetch } from "./client";
import { grokEnv, GrokError, isMockGrok } from "./config";
import { logGrokCall } from "./log";

export const VOICE_TOKEN_TTL_S = 300;

export interface VoiceToken {
  token: string;
  expiresAt: string;
  model: string;
  url: string;
}

let loggedShape = false;

/**
 * The docs do not pin the response shape, so accept the OpenAI-compatible variants:
 * `{ value, expires_at }`, `{ client_secret: { value, expires_at } }`, or `{ token }`.
 * `expires_at` may be unix seconds or ISO.
 */
export function parseClientSecret(body: unknown, now = Date.now()): { token: string; expiresAt: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const cs = (b.client_secret ?? {}) as Record<string, unknown>;
  const token = [b.value, cs.value, b.token, b.secret].find((v): v is string => typeof v === "string" && v.length > 0);
  if (!token) throw new Error("client_secrets response has no token value");
  const rawExp = b.expires_at ?? cs.expires_at;
  let expiresAt: string;
  if (typeof rawExp === "number") expiresAt = new Date(rawExp < 1e12 ? rawExp * 1000 : rawExp).toISOString();
  else if (typeof rawExp === "string" && !Number.isNaN(Date.parse(rawExp))) expiresAt = new Date(rawExp).toISOString();
  else expiresAt = new Date(now + VOICE_TOKEN_TTL_S * 1000).toISOString();
  return { token, expiresAt };
}

export function realtimeUrl(model = grokEnv.voiceModel): string {
  const ws = grokEnv.baseURL.replace(/^http/, "ws");
  return `${ws}/realtime?model=${encodeURIComponent(model)}`;
}

export async function mintVoiceToken(): Promise<VoiceToken> {
  const model = grokEnv.voiceModel;
  const t0 = Date.now();
  if (isMockGrok()) {
    logGrokCall({ op: "voice_token", model, ms: 0, ok: true, mock: true });
    return {
      token: "mock-ephemeral-token",
      expiresAt: new Date(Date.now() + VOICE_TOKEN_TTL_S * 1000).toISOString(),
      model,
      url: realtimeUrl(model),
    };
  }
  try {
    const body = await grokFetch<unknown>("/realtime/client_secrets", {
      op: "voice_token",
      timeoutMs: 10_000,
      body: { expires_after: { seconds: VOICE_TOKEN_TTL_S } },
    });
    if (!loggedShape) {
      loggedShape = true;
      // Log keys only (never the secret) so the first real response documents the shape.
      console.info("[grok] client_secrets response keys:", Object.keys((body ?? {}) as object));
    }
    const { token, expiresAt } = parseClientSecret(body);
    logGrokCall({ op: "voice_token", model, ms: Date.now() - t0, ok: true, mock: false });
    return { token, expiresAt, model, url: realtimeUrl(model) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logGrokCall({ op: "voice_token", model, ms: Date.now() - t0, ok: false, mock: false, error: msg });
    throw new GrokError(`voice token failed: ${msg}`, "voice_token", err);
  }
}
