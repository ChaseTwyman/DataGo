/** Every endpoint the phone calls, typed on the shared contracts (PRD §16 + contracts/lists.ts). */
import {
  BountyDetailSchema,
  CreateSessionResponseSchema,
  CreateSubmissionResponseSchema,
  DevSessionResponseSchema,
  FrameCheckResponseSchema,
  HealthResponseSchema,
  NearbyResponseSchema,
  ProfileResponseSchema,
  SubmissionWithMediaSchema,
  VoiceTokenResponseSchema,
  WalletResponseSchema,
  type CreateSessionRequest,
  type CreateSubmissionRequest,
  type FrameCheckRequest,
  type ProfileRequest,
} from "@groundtruth/shared";
import type { Http } from "./http";

export function endpoints(http: Http) {
  return {
    health: () => http.request("GET", "/api/health", { schema: HealthResponseSchema, auth: false, timeoutMs: 6000 }),
    devSession: (userId?: string) =>
      http.request("POST", "/api/dev/session", {
        schema: DevSessionResponseSchema,
        auth: false,
        body: { role: "contributor", ...(userId ? { user_id: userId } : {}) },
      }),
    nearby: (lat: number, lng: number, radiusKm = 25) =>
      http.request("GET", "/api/bounties/nearby", { schema: NearbyResponseSchema, query: { lat, lng, radius_km: radiusKm } }),
    bounty: (id: string) => http.request("GET", `/api/bounties/${encodeURIComponent(id)}`, { schema: BountyDetailSchema }),
    createSession: (body: CreateSessionRequest) =>
      http.request("POST", "/api/capture/sessions", { schema: CreateSessionResponseSchema, body }),
    frameCheck: (body: FrameCheckRequest) =>
      http.request("POST", "/api/capture/frame-check", {
        schema: FrameCheckResponseSchema,
        body,
        mockVariant: true,
        timeoutMs: 12_000,
      }),
    createSubmission: (body: CreateSubmissionRequest) =>
      http.request("POST", "/api/submissions", { schema: CreateSubmissionResponseSchema, body, mockVariant: true }),
    submission: (id: string) =>
      http.request("GET", `/api/submissions/${encodeURIComponent(id)}`, { schema: SubmissionWithMediaSchema }),
    wallet: () => http.request("GET", "/api/me/wallet", { schema: WalletResponseSchema }),
    voiceToken: () => http.request("POST", "/api/voice/token", { schema: VoiceTokenResponseSchema, body: {} }),
    profile: (body: ProfileRequest) => http.request("POST", "/api/profile", { schema: ProfileResponseSchema, body }),
  };
}

export type Api = ReturnType<typeof endpoints>;
