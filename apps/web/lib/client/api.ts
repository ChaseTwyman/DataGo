"use client";
/**
 * Typed fetch wrapper for the GroundTruth API. Responses are parsed with the shared LENIENT
 * read-side schemas (contracts/lenient.ts): new stages, reason codes or enum values from a newer
 * server render generically. Anything still unreadable becomes code "contract_mismatch"; the UI
 * shows only errorMessage(e) (lib/client/errors.ts), never the technical detail.
 */
import { z } from "zod";
import {
  ApiErrorSchema,
  CoverageResponseSchema,
  CreateBountyRequestSchema,
  CreateBountyResponseSchema,
  ExampleImageResponseSchema,
  LenientBountyDetailSchema,
  LenientBountyListResponseSchema,
  LenientDevSessionResponseSchema,
  LenientHealthResponseSchema,
  LenientProtocolListResponseSchema,
  LenientRedteamRunListResponseSchema,
  LenientRedteamRunResponseSchema,
  LenientReviewResponseSchema,
  LenientSubmissionListResponseSchema,
  LenientSubmissionWithMediaSchema,
  PatchBountyRequestSchema,
  SpawnEventResponseSchema,
  type AttackType,
  type CreateBountyRequest,
  type PatchBountyRequest,
  type Role,
} from "@groundtruth/shared";
import { ApiClientError } from "./errors";
import { getAccessToken } from "./session";

export { ApiClientError, errorMessage, fieldErrors, FriendlyError } from "./errors";

type Unauthorized = () => void;
let onUnauthorized: Unauthorized | null = null;
/** Registered by the dashboard shell: a 401 anywhere sends the user back to login. */
export function setUnauthorizedHandler(fn: Unauthorized | null): void {
  onUnauthorized = fn;
}

interface FetchOpts {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
}

async function rawFetch(path: string, opts: FetchOpts = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  if (opts.auth !== false) {
    const token = await getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiClientError(`Network error: ${(e as Error).message}`, 0, "network");
  }
  if (!res.ok) {
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const err = ApiErrorSchema.safeParse(json);
    if (res.status === 401 && opts.auth !== false) onUnauthorized?.();
    throw new ApiClientError(
      err.success ? err.data.error.message : `${res.status} ${res.statusText}`.trim(),
      res.status,
      err.success ? err.data.error.code : "http_error",
      err.success ? err.data.error.details : undefined,
    );
  }
  return res;
}

export async function apiFetch<T>(path: string, schema: z.ZodType<T>, opts: FetchOpts = {}): Promise<T> {
  const res = await rawFetch(path, opts);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiClientError(`Non-JSON response from ${path}`, res.status, "contract_mismatch");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError(
      `Unexpected response from ${path}: ${z.prettifyError(parsed.error)}`,
      res.status,
      "contract_mismatch",
      parsed.error.issues,
    );
  }
  return parsed.data;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export type ExportFormat = "csv" | "geojson" | "dictionary";

export const api = {
  health: () => apiFetch("/api/health", LenientHealthResponseSchema, { auth: false }),
  devSession: (role: Role = "researcher") =>
    apiFetch("/api/dev/session", LenientDevSessionResponseSchema, { body: { role }, auth: false }),

  protocols: () => apiFetch("/api/protocols", LenientProtocolListResponseSchema),
  exampleImage: (protocolId: string) =>
    apiFetch(`/api/protocols/${protocolId}/example-image`, ExampleImageResponseSchema, { body: {} }),

  bounties: () => apiFetch("/api/bounties", LenientBountyListResponseSchema),
  bounty: (id: string) => apiFetch(`/api/bounties/${id}`, LenientBountyDetailSchema),
  coverage: (id: string) => apiFetch(`/api/bounties/${id}/coverage`, CoverageResponseSchema),
  createBounty: (input: z.input<typeof CreateBountyRequestSchema>) => {
    const body: CreateBountyRequest = CreateBountyRequestSchema.parse(input);
    return apiFetch("/api/bounties", CreateBountyResponseSchema, { body });
  },
  patchBounty: (id: string, patch: PatchBountyRequest) =>
    // PATCH's response shape is not in the contracts; callers refetch the bounty afterwards.
    apiFetch(`/api/bounties/${id}`, z.unknown(), {
      method: "PATCH",
      body: PatchBountyRequestSchema.parse(patch),
    }),

  submissions: (q: { bounty_id?: string; status?: string; limit?: number } = {}) =>
    apiFetch(`/api/submissions${qs(q)}`, LenientSubmissionListResponseSchema),
  submission: (id: string) => apiFetch(`/api/submissions/${id}`, LenientSubmissionWithMediaSchema),
  review: (id: string, decision: "approve" | "reject", integrity = false, note?: string) =>
    apiFetch(`/api/submissions/${id}/review`, LenientReviewResponseSchema, {
      body: { decision, integrity: decision === "reject" ? integrity : false, ...(note ? { note } : {}) },
    }),

  redteamRun: (bounty_id: string, attack_type: AttackType) =>
    apiFetch("/api/redteam/run", LenientRedteamRunResponseSchema, { body: { bounty_id, attack_type } }),
  redteamRuns: (bounty_id?: string) => apiFetch(`/api/redteam/runs${qs({ bounty_id })}`, LenientRedteamRunListResponseSchema),

  spawnEvent: (lat: number, lng: number, radius_m?: number) =>
    apiFetch("/api/demo/spawn-event", SpawnEventResponseSchema, {
      body: { lat, lng, ...(radius_m ? { radius_m } : {}) },
    }),

  /** Exports need the bearer header, so fetch → blob → trigger a download. */
  async download(bountyId: string, format: ExportFormat): Promise<void> {
    const res = await rawFetch(`/api/bounties/${bountyId}/export${qs({ format })}`);
    let blob: Blob;
    try {
      blob = await res.blob();
    } catch {
      throw new ApiClientError("export body interrupted", 0, "network");
    }
    const cd = res.headers.get("content-disposition") ?? "";
    const m = /filename="?([^";]+)"?/i.exec(cd);
    const ct = res.headers.get("content-type") ?? "";
    const ext = format === "geojson" ? "geojson" : format === "csv" ? "csv" : ct.includes("json") ? "json" : "md";
    const name = m?.[1] ?? `groundtruth-${bountyId.slice(0, 8)}-${format}.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
