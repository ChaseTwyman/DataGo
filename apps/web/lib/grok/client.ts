import OpenAI from "openai";
import { grokEnv, requireKey } from "./config";

let client: OpenAI | null = null;

/** OpenAI SDK pointed at xAI. Server-only: the API key never leaves the server. */
export function grokClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: requireKey("client"), baseURL: grokEnv.baseURL, maxRetries: 1 });
  }
  return client;
}

/** Raw JSON POST/GET for endpoints the SDK types don't cover (images with aspect_ratio, videos, client_secrets). */
export async function grokFetch<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; op: string },
): Promise<T> {
  const key = requireKey(init.op);
  const res = await fetch(`${grokEnv.baseURL}${path}`, {
    method: init.method ?? "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.op} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}
