"use client";
/**
 * Typed fetch wrapper for the GroundTruth API. Responses are parsed with the shared LENIENT
 * read-side schemas (contracts/lenient.ts): new stages, reason codes or enum values from a newer
 * server render generically. Anything still unreadable becomes code "contract_mismatch"; the UI
 * shows only errorMessage(e) (lib/client/errors.ts), never the technical detail.
 */
import { z } from "zod";
import {
  AdminResetPasswordResponseSchema,
  AdminUserListResponseSchema,
  AdminUserSchema,
  ApiErrorSchema,
  DraftProtocolResponseSchema,
  MeSchema,
  PasswordResetConfirmResponseSchema,
  PasswordResetRequestResponseSchema,
  SignupResponseSchema,
  type PasswordResetConfirmRequest,
  type AdminUserPatchSchema,
  type BecomeResearcherRequestSchema,
  type ChangePasswordRequestSchema,
  type Protocol,
  type SignupRequest,
  BriefingVideoResponseSchema,
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
  AllocationResultSchema,
  ContributionSchema,
  FundingOverviewSchema,
  PricingPreviewRequestSchema,
  PricingPreviewResponseSchema,
  RunAllocationResponseSchema,
  SponsorSchema,
  type CreateContributionRequestSchema,
  type CreateSponsorRequestSchema,
  type PatchSponsorRequest,
  type SetAllocationRequest,
  type AttackType,
  type CreateBountyRequest,
  type PatchBountyRequest,
  type Role,
} from "@groundtruth/shared";
import { ApiClientError } from "./errors";
import {
  LenientGrokbotMessageSchema,
  LenientPublicFundingSchema,
  LenientRadarScanResponseSchema,
  LenientReviewBriefSchema,
  LenientSelfCheckSchema,
  LenientSponsorImpactSchema,
} from "./grokbot";
import { getAccessToken } from "./session";

export { ApiClientError, errorMessage, fieldErrors, FriendlyError } from "./errors";

type Unauthorized = () => void;
let onUnauthorized: Unauthorized | null = null;
/** Registered by the dashboard shell: a 401 anywhere sends the user back to login. */
export function setUnauthorizedHandler(fn: Unauthorized | null): void {
  onUnauthorized = fn;
}

interface FetchOpts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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

/** Saves a fetched response as a file (exports need the bearer header, so no plain link). */
async function saveResponse(res: Response, fallbackName: string): Promise<void> {
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    throw new ApiClientError("download body interrupted", 0, "network");
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^";]+)"?/i.exec(cd);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = m?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const OkSchema = z.object({ ok: z.literal(true) });
const DevLoginResponseSchema = LenientDevSessionResponseSchema;

export type ExportFormat = "csv" | "geojson" | "dictionary";

export const api = {
  health: () => apiFetch("/api/health", LenientHealthResponseSchema, { auth: false }),
  devSession: (role: Role = "researcher") =>
    apiFetch("/api/dev/session", LenientDevSessionResponseSchema, { body: { role }, auth: false }),

  // ---- accounts
  signup: (body: SignupRequest) => apiFetch("/api/auth/signup", SignupResponseSchema, { body, auth: false }),
  devLogin: (email: string, password: string) =>
    apiFetch("/api/dev/login", DevLoginResponseSchema, { body: { email, password }, auth: false }),
  requestPasswordReset: (email: string) =>
    apiFetch("/api/auth/password-reset/request", PasswordResetRequestResponseSchema, { body: { email }, auth: false }),
  confirmPasswordReset: (body: PasswordResetConfirmRequest) =>
    apiFetch("/api/auth/password-reset/confirm", PasswordResetConfirmResponseSchema, { body, auth: false }),
  me: () => apiFetch("/api/me", MeSchema),
  becomeResearcher: (body: z.input<typeof BecomeResearcherRequestSchema>) => apiFetch("/api/me/researcher", MeSchema, { body }),
  stopResearcher: () => apiFetch("/api/me/researcher", MeSchema, { method: "DELETE" }),
  changePassword: (body: z.input<typeof ChangePasswordRequestSchema>) => apiFetch("/api/me/password", OkSchema, { body }),
  async downloadMyData(): Promise<void> {
    await saveResponse(await rawFetch("/api/me/export"), "groundtruth-my-data.json");
  },
  async deleteAccount(): Promise<void> {
    await rawFetch("/api/me", { method: "DELETE", body: { confirm: "DELETE" } });
  },
  adminUsers: (q: { q?: string; limit?: number } = {}) => apiFetch(`/api/admin/users${qs(q)}`, AdminUserListResponseSchema),
  adminPatchUser: (id: string, patch: z.input<typeof AdminUserPatchSchema>) =>
    apiFetch(`/api/admin/users/${id}`, AdminUserSchema, { method: "PATCH", body: patch }),
  adminResetPassword: (id: string) => apiFetch(`/api/admin/users/${id}/reset-password`, AdminResetPasswordResponseSchema, { body: {} }),

  // ---- protocols
  protocols: () => apiFetch("/api/protocols", LenientProtocolListResponseSchema),
  draftProtocol: (need: string) => apiFetch("/api/protocols/draft", DraftProtocolResponseSchema, { body: { need } }),
  publishProtocol: (id: string, definition: Protocol) =>
    apiFetch(`/api/protocols/${id}/publish`, z.object({ id: z.string(), status: z.string() }), { body: { definition } }),
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

  /** Platform pricing engine preview for a draft data request (server-side only). */
  pricingPreview: (input: z.input<typeof PricingPreviewRequestSchema>) =>
    apiFetch("/api/pricing/preview", PricingPreviewResponseSchema, { body: PricingPreviewRequestSchema.parse(input) }),

  // ---- sponsor pool (admin)
  adminFunding: () => apiFetch("/api/admin/funding", FundingOverviewSchema),
  adminRunAllocation: () => apiFetch("/api/admin/funding/run", RunAllocationResponseSchema, { body: {} }),
  adminCreateSponsor: (body: z.input<typeof CreateSponsorRequestSchema>) => apiFetch("/api/admin/sponsors", SponsorSchema, { body }),
  adminPatchSponsor: (id: string, body: PatchSponsorRequest) => apiFetch(`/api/admin/sponsors/${id}`, SponsorSchema, { method: "PATCH", body }),
  adminContribute: (body: z.input<typeof CreateContributionRequestSchema>) =>
    apiFetch("/api/admin/funding/contributions", z.object({ contribution: ContributionSchema }), { body }),
  adminReverseContribution: (id: string, amount_cents: number, note: string) =>
    apiFetch(`/api/admin/funding/contributions/${id}/reverse`, z.object({ contribution: ContributionSchema }), { body: { amount_cents, note } }),
  adminSetAllocation: (bountyId: string, body: SetAllocationRequest) =>
    apiFetch(`/api/admin/bounties/${bountyId}/allocation`, AllocationResultSchema, { body }),
  publicFunding: () => apiFetch("/api/public/funding", LenientPublicFundingSchema, { auth: false }),

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

  /** Opportunity Radar: NWS alerts + grok-4.7 (x_search, web_search) → drafted bounties. Can take minutes. */
  radarScan: (body: { lat: number; lng: number; radius_km: number }) => apiFetch("/api/radar/scan", LenientRadarScanResponseSchema, { body }),
  /** Starts a Grok Imagine briefing clip (202); poll the bounty for briefing_video_url. */
  briefingVideo: (bountyId: string) => apiFetch(`/api/bounties/${bountyId}/briefing-video`, BriefingVideoResponseSchema, { body: {} }),

  // ---- Grokbot (contracts/grokbot.ts). Explains, drafts, suggests; never changes state.
  /** Role-scoped explanation of a submission (researcher view). `refresh` asks for a new one. */
  grokbotExplain: (submissionId: string, refresh = false) =>
    apiFetch(`/api/grokbot/submissions/${submissionId}/explain${qs({ refresh: refresh ? 1 : undefined })}`, LenientGrokbotMessageSchema),
  /** Why a request is funded / pending / paused, and what would help (owner or admin). */
  grokbotBountyStatus: (bountyId: string, refresh = false) =>
    apiFetch(`/api/grokbot/bounties/${bountyId}/status${qs({ refresh: refresh ? 1 : undefined })}`, LenientGrokbotMessageSchema),
  /** Evidence + uncertainty for a needs_review submission. Deliberately no verdict. */
  grokbotReviewBrief: (submissionId: string, refresh = false) =>
    apiFetch(`/api/grokbot/submissions/${submissionId}/review-brief${qs({ refresh: refresh ? 1 : undefined })}`, LenientReviewBriefSchema),
  /** Runs the protocol example through the live checks before publishing (~30–60 s). */
  grokbotSelfCheck: (protocolId: string) => apiFetch(`/api/grokbot/protocols/${protocolId}/self-check`, LenientSelfCheckSchema, { body: {} }),
  grokbotSponsorImpact: (sponsorId: string, range: { from?: string; to?: string } = {}, refresh = false) =>
    apiFetch(`/api/grokbot/sponsors/${sponsorId}/impact${qs({ ...range, refresh: refresh ? 1 : undefined })}`, LenientSponsorImpactSchema),
  /** Public, aggregate-only impact view (no login). */
  publicSponsorImpact: (sponsorId: string, range: { from?: string; to?: string } = {}) =>
    apiFetch(`/api/public/sponsors/${sponsorId}/impact${qs(range)}`, LenientSponsorImpactSchema, { auth: false }),

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
