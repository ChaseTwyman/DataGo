/** Every Grok call is logged with model, duration, and token usage to track cost (BUILD_PROMPT §9). */

export interface GrokUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  /** Responses API: reasoning tokens are part of output_tokens (they dominate grok-4.7 latency). */
  output_tokens_details?: { reasoning_tokens?: number } | null;
  input_tokens_details?: { cached_tokens?: number } | null;
}

export interface GrokCallLog {
  op: string;
  model: string;
  ms: number;
  ok: boolean;
  mock: boolean;
  usage?: GrokUsage | null;
  attempt?: number;
  error?: string;
}

type Sink = (entry: GrokCallLog) => void;

let sink: Sink = (e) => {
  const reasoning = e.usage?.output_tokens_details?.reasoning_tokens;
  const usage = e.usage
    ? ` in=${e.usage.input_tokens ?? "?"} out=${e.usage.output_tokens ?? "?"}${reasoning !== undefined ? ` reasoning=${reasoning}` : ""}`
    : "";
  const line = `[grok] ${e.op} model=${e.model} ${e.ms}ms ok=${e.ok}${e.mock ? " (mock)" : ""}${usage}${e.error ? ` error=${e.error}` : ""}`;
  if (e.ok) console.info(line);
  else console.warn(line);
};

export function logGrokCall(entry: GrokCallLog): void {
  sink(entry);
}

/** Tests swap the sink to assert on logging. Returns the previous sink. */
export function setGrokLogSink(next: Sink): Sink {
  const prev = sink;
  sink = next;
  return prev;
}
