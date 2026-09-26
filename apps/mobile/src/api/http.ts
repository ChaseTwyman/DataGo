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
  /**
   * Called once when an authenticated call gets a 401 (expired/revoked token). Resolve true after
   * obtaining a fresh token and the call is retried once, silently; false/throw → the 401 surfaces.
   */
  reauth?: () => Promise<boolean>;
  /** Codes for which a refresh cannot help (e.g. ACCOUNT_REQUIRED): no reauth attempt. */
  noReauthCodes?: ReadonlySet<string>;
  /** Observes every ApiError an authenticated call finally throws (session handling hooks in here). */
  onAuthedError?: (e: ApiError) => void;
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
    try {
      return await this.withReauth(method, path, r);
    } catch (e) {
      if (e instanceof ApiError && r.auth !== false) {
        try {
          this.o.onAuthedError?.(e);
        } catch {
          // An observer must never change what the caller sees.
        }
      }
      throw e;
    }
  }

  private async withReauth<S extends z.ZodType>(method: string, path: string, r: RequestOptions<S>): Promise<z.infer<S>> {
    try {
      return await this.once(method, path, r);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || r.auth === false || !this.o.reauth) throw e;
      if (this.o.noReauthCodes?.has(e.code)) throw e;
      let renewed = false;
      try {
        renewed = await this.o.reauth();
      } catch {
        renewed = false;
      }
      if (!renewed) throw e;
      return this.once(method, path, r);
    }
  }

  private async once<S extends z.ZodType>(method: string, path: string, r: RequestOptions<S>): Promise<z.infer<S>> {
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
