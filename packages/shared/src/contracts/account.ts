/**
 * Accounts (product decision, 2026-09-26): everyone signs up with email + password; one account
 * can be both a contributor and a researcher. Contributors need an account for payouts, researchers
 * for their bounties/protocols. Open data stays public with no login.
 *
 * Sign-up goes through our server (Supabase admin API creates the user already confirmed), so no
 * email is ever sent. Anonymous Supabase users are refused by the API.
 */
import { z } from "zod";
import { IsoDate, Uuid } from "./common";

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);
export const PasswordSchema = z.string().min(8, "Use at least 8 characters.").max(72);

// POST /api/auth/signup (no auth). Client then signs in with Supabase password grant.
export const SignupRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  display_name: z.string().trim().min(1).max(80),
  is_adult: z.literal(true, { message: "You must be 18 or older." }),
  accept_terms: z.literal(true, { message: "Please accept the terms and data license." }),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;
export const SignupResponseSchema = z.object({ user_id: Uuid });

export const ResearcherProfileSchema = z.object({
  organization: z.string().trim().min(2).max(120),
  purpose: z.string().trim().min(10).max(1000),
});
export type ResearcherProfile = z.infer<typeof ResearcherProfileSchema>;

// GET /api/me
export const MeSchema = z.object({
  id: Uuid,
  email: z.string().nullable(),
  display_name: z.string().nullable(),
  /** Every account can contribute. */
  is_contributor: z.boolean(),
  is_researcher: z.boolean(),
  is_admin: z.boolean(),
  suspended: z.boolean(),
  researcher_profile: ResearcherProfileSchema.nullable(),
  trust_score: z.number(),
  balance_cents: z.number().int(),
  created_at: IsoDate,
});
export type Me = z.infer<typeof MeSchema>;

// POST /api/me/researcher → Me (self-serve; admins can revoke). DELETE /api/me/researcher → Me.
export const BecomeResearcherRequestSchema = ResearcherProfileSchema.extend({
  accept_terms: z.literal(true, { message: "Please accept the researcher terms." }),
});

// POST /api/me/password → { ok: true }
export const ChangePasswordRequestSchema = z.object({
  current_password: z.string().min(1),
  new_password: PasswordSchema,
});

// GET /api/me/export → JSON attachment (profile, sessions, submissions + signed media URLs, ledger).
// DELETE /api/me { confirm: "DELETE" } → 204. Photos, profile, wallet and sessions are deleted;
// accepted observations already released under the open-data license stay in the public dataset,
// de-identified (reassigned to a deleted-user placeholder).
export const DeleteAccountRequestSchema = z.object({ confirm: z.literal("DELETE") });

// Admin: GET /api/admin/users?q&limit
export const AdminUserQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const AdminUserSchema = z.object({
  id: Uuid,
  email: z.string().nullable(),
  display_name: z.string().nullable(),
  is_researcher: z.boolean(),
  is_admin: z.boolean(),
  suspended: z.boolean(),
  researcher_profile: ResearcherProfileSchema.nullable(),
  trust_score: z.number(),
  submissions: z.number().int(),
  created_at: IsoDate,
});
export type AdminUser = z.infer<typeof AdminUserSchema>;
export const AdminUserListResponseSchema = z.object({ users: z.array(AdminUserSchema) });
// PATCH /api/admin/users/:id → AdminUser. An admin cannot remove their own admin flag.
export const AdminUserPatchSchema = z.object({
  is_researcher: z.boolean().optional(),
  is_admin: z.boolean().optional(),
  suspended: z.boolean().optional(),
});
// POST /api/admin/users/:id/reset-password → shown once to the admin to hand over.
export const AdminResetPasswordResponseSchema = z.object({ temporary_password: z.string() });

/** Error codes the account routes use (message text is human-readable; clients map by code). */
export const ACCOUNT_ERROR_CODES = [
  "EMAIL_TAKEN",
  "INVALID_CREDENTIALS",
  "ACCOUNT_REQUIRED", // anonymous/legacy session: create an account
  "ACCOUNT_SUSPENDED",
  "RESEARCHER_REQUIRED",
  "ADMIN_REQUIRED",
  "RATE_LIMITED",
  // additive (web track): admin revoked researcher access, so self-serve re-enable is refused
  "RESEARCHER_REVOKED",
  // additive: an admin tried to remove their own admin flag or suspend themselves
  "CANNOT_CHANGE_SELF",
] as const;
