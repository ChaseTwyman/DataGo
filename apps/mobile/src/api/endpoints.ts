/**
 * Every endpoint the phone calls, typed on the shared contracts (PRD §16 + contracts/lists.ts).
 * Responses are parsed with the LENIENT read-side schemas: an installed build must keep working when
 * a newer server adds stages, reason codes or enum values (packages/shared/src/contracts/lenient.ts).
 */
import {
  FrameCheckResponseSchema,
  LenientBountyDetailSchema,
  LenientCreateSessionResponseSchema,
  LenientCreateSubmissionResponseSchema,
  LenientDevSessionResponseSchema,
  LenientHealthResponseSchema,
  LenientNearbyResponseSchema,
  LenientSubmissionWithMediaSchema,
  LenientWalletResponseSchema,
  MeSchema,
  ProfileResponseSchema,
  SignupResponseSchema,
  VoiceTokenResponseSchema,
  type ChangePasswordRequestSchema,
  type CreateSessionRequest,
  type DeleteAccountRequestSchema,
  type SignupRequest,
  type CreateSubmissionRequest,
  type FrameCheckRequest,
  type ProfileRequest,
} from "@groundtruth/shared";
import { z } from "zod";
import type { Http } from "./http";

type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;

export function endpoints(http: Http) {
  return {
    health: () => http.request("GET", "/api/health", { schema: LenientHealthResponseSchema, auth: false, timeoutMs: 6000 }),
    devSession: (userId?: string) =>
      http.request("POST", "/api/dev/session", {
        schema: LenientDevSessionResponseSchema,
        auth: false,
        body: { role: "contributor", ...(userId ? { user_id: userId } : {}) },
      }),
    nearby: (lat: number, lng: number, radiusKm = 25) =>
      http.request("GET", "/api/bounties/nearby", { schema: LenientNearbyResponseSchema, query: { lat, lng, radius_km: radiusKm } }),
    bounty: (id: string) => http.request("GET", `/api/bounties/${encodeURIComponent(id)}`, { schema: LenientBountyDetailSchema }),
    createSession: (body: CreateSessionRequest) =>
      http.request("POST", "/api/capture/sessions", { schema: LenientCreateSessionResponseSchema, body }),
    frameCheck: (body: FrameCheckRequest) =>
      http.request("POST", "/api/capture/frame-check", {
        schema: FrameCheckResponseSchema,
        body,
        mockVariant: true,
        timeoutMs: 12_000,
      }),
    createSubmission: (body: CreateSubmissionRequest) =>
      http.request("POST", "/api/submissions", { schema: LenientCreateSubmissionResponseSchema, body, mockVariant: true }),
    submission: (id: string) =>
      http.request("GET", `/api/submissions/${encodeURIComponent(id)}`, { schema: LenientSubmissionWithMediaSchema }),
    wallet: () => http.request("GET", "/api/me/wallet", { schema: LenientWalletResponseSchema }),
    voiceToken: () => http.request("POST", "/api/voice/token", { schema: VoiceTokenResponseSchema, body: {} }),
    profile: (body: ProfileRequest) => http.request("POST", "/api/profile", { schema: ProfileResponseSchema, body }),

    // Accounts (contracts/account.ts)
    signup: (body: SignupRequest) => http.request("POST", "/api/auth/signup", { schema: SignupResponseSchema, body, auth: false }),
    /** Always 202 with the same body, whether or not the email has an account. */
    requestPasswordReset: (email: string) =>
      http.request("POST", "/api/auth/password-reset/request", { schema: z.unknown(), body: { email }, auth: false }),
    /** Wrong/expired code → ApiError RESET_CODE_INVALID. Signs the account out everywhere on success. */
    confirmPasswordReset: (body: { email: string; code: string; new_password: string }) =>
      http.request("POST", "/api/auth/password-reset/confirm", {
        schema: z.object({ ok: z.boolean(), sessions_revoked: z.boolean().optional() }).loose(),
        body,
        auth: false,
      }),
    me: () => http.request("GET", "/api/me", { schema: MeSchema }),
    changePassword: (body: ChangePasswordRequest) =>
      http.request("POST", "/api/me/password", { schema: z.object({ ok: z.boolean() }).loose(), body }),
    /** The whole export as parsed JSON (shape owned by the server; the phone only saves/shares it). */
    exportData: () => http.request("GET", "/api/me/export", { schema: z.unknown(), timeoutMs: 60_000 }),
    /** 204 on success. Body must be exactly { confirm: "DELETE" }. */
    deleteAccount: (body: DeleteAccountRequest) => http.request("DELETE", "/api/me", { schema: z.unknown(), body }),
  };
}

export type Api = ReturnType<typeof endpoints>;
