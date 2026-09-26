/**
 * Accounts (product decision, 2026-09-26): everyone signs up with email + password; one account
 * can be both a contributor and a researcher. Contributors need an account for payouts, researchers
 * for their bounties/protocols. Open data stays public with no login.
 *
 * Sign-up goes through our server (Supabase admin API creates the user already confirmed), so no
 * sign-up email is sent. The only email is the forgot-password code. Anonymous Supabase users are
 * refused by the API.
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
  /** Additive (Grokbot For-you): the profile fields matches are computed from, so forms can prefill. */
  occupation: z.string().nullable().optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  regular_areas: z.array(z.object({ label: z.string(), description: z.string() })).optional(),
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

// Forgot password (additive, 2026-09-26): Supabase Auth's recovery email carries a one-time code
// ({{ .Token }}, 6 digits by default) and a link to /reset-password?token_hash=… Both are redeemed
// on our server, so the phone needs no deep links. No auth on either route; both are rate-limited.

/** The emailed recovery code. Supabase's OTP length is configurable (6 by default, up to 10). */
export const ResetCodeSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6,10}$/, "Enter the 6-digit code from the email."));

// POST /api/auth/password-reset/request (no auth) → 202, the SAME body whether or not the email
// has an account (no account enumeration).
export const PasswordResetRequestSchema = z.object({ email: EmailSchema });
export const PasswordResetRequestResponseSchema = z.object({ ok: z.literal(true) });

// POST /api/auth/password-reset/confirm (no auth) → { ok, email }. Either the emailed code (with
// the email it was sent to) or the link's token_hash. Wrong/expired → 400 RESET_CODE_INVALID.
// Success sets the password and signs the account out everywhere; the client then signs in.
export const PasswordResetCodeConfirmSchema = z.object({ email: EmailSchema, code: ResetCodeSchema, new_password: PasswordSchema });
export const PasswordResetLinkConfirmSchema = z.object({ token_hash: z.string().trim().min(8).max(512), new_password: PasswordSchema });
export const PasswordResetConfirmRequestSchema = z.union([PasswordResetCodeConfirmSchema, PasswordResetLinkConfirmSchema]);
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequestSchema>;
export const PasswordResetConfirmResponseSchema = z.object({
  ok: z.literal(true),
  email: z.string().nullable(),
  /** false = the password changed but signing out other devices failed (clients must not claim it). */
  sessions_revoked: z.boolean().optional(),
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
  // additive: forgot-password code/link is wrong, expired or already used
  "RESET_CODE_INVALID",
] as const;
