/**
 * Transport-agnostic typed HTTP core, validated with the shared zod contracts. Pure TS (fetch is
 * injected) so it is unit-tested under node.
 */
import { ApiErrorSchema, MOCK_VARIANT_HEADER, type MockVariant } from "@groundtruth/shared";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface HttpOptions {
  baseUrl: string;
  fetch: FetchLike;
  getToken: () => Promise<string | null> | string | null;
  getMockVariant?: () => MockVariant | null;
  timeoutMs?: number;
}

export interface RequestOptions<S extends z.ZodType> {
  schema: S;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
  /** Send x-mock-variant (dev setting) on this call. */
  mockVariant?: boolean;
  timeoutMs?: number;
}

export function buildUrl(base: string, path: string, query?: Record<string, string | number | undefined>): string {
  const q = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  return `${base.replace(/\/+$/, "")}${path}${q ? `?${q}` : ""}`;
}

export class Http {
  constructor(private readonly o: HttpOptions) {}

  async request<S extends z.ZodType>(method: string, path: string, r: RequestOptions<S>): Promise<z.infer<S>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (r.body !== undefined) headers["Content-Type"] = "application/json";
    if (r.auth !== false) {
      const token = await this.o.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const variant = r.mockVariant ? this.o.getMockVariant?.() : null;
    if (variant && variant !== "default") headers[MOCK_VARIANT_HEADER] = variant;

    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = r.timeoutMs ?? this.o.timeoutMs ?? 20_000;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.o.fetch(buildUrl(this.o.baseUrl, path, r.query), {
        method,
        headers,
        body: r.body === undefined ? undefined : JSON.stringify(r.body),
        signal: ctrl?.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      throw new ApiError(0, aborted ? "TIMEOUT" : "NETWORK", aborted ? `Request timed out: ${path}` : `Network error: ${path}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiError(res.status, "BAD_JSON", `Non-JSON response from ${path} (${res.status})`);
      }
    }
    if (!res.ok) {
      const parsed = ApiErrorSchema.safeParse(json);
      if (parsed.success) throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
      throw new ApiError(res.status, `HTTP_${res.status}`, `${method} ${path} failed (${res.status})`);
    }
    const parsed = r.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(res.status, "CONTRACT_MISMATCH", `Response of ${path} does not match the shared contract`, parsed.error.issues);
    }
    return parsed.data;
  }
}
