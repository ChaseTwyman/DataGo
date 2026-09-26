/**
 * grokJSON: one Responses API call with a strict JSON schema, zod-validated, one retry on parse
 * failure (BUILD_PROMPT §5). `store: false` always: requests may carry images.
 */
import type { JsonSchema } from "@groundtruth/shared";
import { grokClient } from "./client";
import { GrokError, isMockGrok } from "./config";
import { logGrokCall, type GrokUsage } from "./log";

export type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" | "low" | "auto" };

export interface GrokJSONArgs<T> {
  op: string;
  model: string;
  system: string;
  content: InputPart[];
  /** JSON Schema sent as text.format.json_schema. */
  schema: JsonSchema;
  /** Schema name (letters, digits, underscores). */
  name: string;
  /** Runtime validation of the parsed output. */
  parse: (raw: unknown) => T;
  timeoutMs?: number;
  /**
   * SDK-level retries on network errors/timeouts (default: the client's 1). Set 0 for long calls:
   * a retried 60 s timeout silently doubled verification to 120 s (and the cost) on Vercel.
   */
  maxRetries?: number;
  /** Server-side tools (e.g. web_search, x_search) for P1 features. */
  tools?: { type: "web_search" | "x_search" }[];
  /** Deterministic fixture returned when MOCK_GROK=1. */
  mock: () => T | Promise<T>;
}

export const jpegDataUrl = (base64: string): string =>
  base64.startsWith("data:") ? base64 : `data:image/jpeg;base64,${base64}`;

export const imagePart = (base64: string, detail: "high" | "low" = "high"): InputPart => ({
  type: "input_image",
  image_url: jpegDataUrl(base64),
  detail,
});

export async function grokJSON<T>(args: GrokJSONArgs<T>): Promise<T> {
  if (isMockGrok()) {
    const t0 = Date.now();
    const out = await args.mock();
    logGrokCall({ op: args.op, model: args.model, ms: Date.now() - t0, ok: true, mock: true });
    return out;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    let usage: GrokUsage | null = null;
    try {
      const response = await grokClient().responses.create(
        {
          model: args.model,
          store: false,
          input: [
            { role: "system", content: args.system },
            // The SDK's input types are a wide union; our InputPart is a structural subset of it.
            { role: "user", content: args.content as never },
          ],
          text: { format: { type: "json_schema", name: args.name, schema: args.schema, strict: true } },
          ...(args.tools ? { tools: args.tools as never } : {}),
        },
        { timeout: args.timeoutMs ?? 30_000, ...(args.maxRetries !== undefined ? { maxRetries: args.maxRetries } : {}) },
      );
      usage = (response.usage as GrokUsage | undefined) ?? null;
      const text = response.output_text;
      if (!text) throw new Error("empty output_text");
      const parsed = args.parse(JSON.parse(text));
      logGrokCall({ op: args.op, model: args.model, ms: Date.now() - t0, ok: true, mock: false, usage, attempt });
      return parsed;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      logGrokCall({ op: args.op, model: args.model, ms: Date.now() - t0, ok: false, mock: false, usage, attempt, error: msg });
      // Retry only on parse/validation failures; network/timeout/HTTP errors surface immediately.
      if (!isParseError(err)) break;
    }
  }
  throw new GrokError(`${args.op} failed: ${errorMessage(lastError)}`, args.op, lastError);
}

function isParseError(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  if (err && typeof err === "object" && "issues" in err) return true; // ZodError
  return err instanceof Error && /empty output_text|extraction missing/.test(err.message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

