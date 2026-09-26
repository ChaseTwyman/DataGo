/**
 * Bearer auth for API routes.
 * - Supabase mode: `Authorization: Bearer <supabase access token>` → auth.getUser → profile flags.
 * - LOCAL_BACKEND=1: additionally accepts `dev.<uuid>` tokens minted by POST /api/dev/session or
 *   POST /api/dev/login. Dev tokens are refused outright when LOCAL_BACKEND is off.
 *
 * Accounts (migration 000006): every caller must be a real (email) account — anonymous Supabase
 * users get 401 ACCOUNT_REQUIRED — and not suspended (403 ACCOUNT_SUSPENDED). Authorization reads
 * the `is_researcher` / `is_admin` flags; `role` is derived from them for older call sites.
 */
import { DEV_TOKEN_PREFIX, type Role } from "@groundtruth/shared";
import { HttpError, unauthorized } from "./api/http";
import { getDb } from "./db";
import { getProfile } from "./db/repos/profiles";
import { isLocalBackend } from "./env";
import { supabaseAdmin } from "./supabase/admin";

export interface AuthUser {
  id: string;
  email: string | null;
  /** Derived from the flags: admin > researcher > contributor. Use the flags for decisions. */
  role: Role;
  isResearcher: boolean;
  isAdmin: boolean;
  trustScore: number;
}

interface TokenIdentity {
  id: string;
  email: string | null;
  isAnonymous: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const accountRequired = () => new HttpError(401, "ACCOUNT_REQUIRED", "Create an account to continue");
export const accountSuspended = () =>
  new HttpError(403, "ACCOUNT_SUSPENDED", "This account is suspended. Contact the GroundTruth team if you think this is a mistake.");
export const researcherRequired = () =>
  new HttpError(403, "RESEARCHER_REQUIRED", "Turn on researcher access in your account to use this.");
export const adminRequired = () => new HttpError(403, "ADMIN_REQUIRED", "Only administrators can do this.");

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

export function devTokenFor(userId: string): string {
  return `${DEV_TOKEN_PREFIX}${userId}`;
}

async function identityFromToken(token: string): Promise<TokenIdentity | null> {
  if (token.startsWith(DEV_TOKEN_PREFIX)) {
    if (!isLocalBackend()) return null;
    const id = token.slice(DEV_TOKEN_PREFIX.length);
    if (!UUID_RE.test(id)) return null;
    const rows = await (await getDb()).query<{ email: string | null; is_anonymous: boolean | null }>(
      "select email, is_anonymous from auth.users where id = $1",
      [id.toLowerCase()],
    );
    const u = rows[0];
    if (!u) return null;
    return { id: id.toLowerCase(), email: u.email, isAnonymous: u.is_anonymous === true || !u.email };
  }
  if (isLocalBackend()) return null; // no Supabase Auth in local mode
  try {
    const { data, error } = await supabaseAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    const u = data.user as { id: string; email?: string | null; is_anonymous?: boolean };
    const email = u.email || null;
    return { id: u.id, email, isAnonymous: u.is_anonymous === true || !email };
  } catch {
    return null;
  }
}

/** Resolves the caller's user id from the token, or null. Never throws for bad tokens. */
export async function userIdFromToken(token: string): Promise<string | null> {
  return (await identityFromToken(token))?.id ?? null;
}

type Resolved = { kind: "none" } | { kind: "anonymous" } | { kind: "suspended" } | { kind: "ok"; user: AuthUser };

async function resolve(req: Request): Promise<Resolved> {
  const token = bearerToken(req);
  if (!token) return { kind: "none" };
  const ident = await identityFromToken(token);
  if (!ident) return { kind: "none" };
  if (ident.isAnonymous) return { kind: "anonymous" };
  const profile = await getProfile(await getDb(), ident.id);
  if (!profile) return { kind: "none" };
  if (profile.suspended_at) return { kind: "suspended" };
  return {
    kind: "ok",
    user: {
      id: ident.id,
      email: ident.email,
      role: profile.is_admin ? "admin" : profile.is_researcher ? "researcher" : "contributor",
      isResearcher: profile.is_researcher,
      isAdmin: profile.is_admin,
      trustScore: profile.trust_score,
    },
  };
}

/** The signed-in, active account, or null (anonymous and suspended callers are null too). */
export async function getAuth(req: Request): Promise<AuthUser | null> {
  const r = await resolve(req);
  return r.kind === "ok" ? r.user : null;
}

export async function requireUser(req: Request): Promise<AuthUser> {
  const r = await resolve(req);
  if (r.kind === "anonymous") throw accountRequired();
  if (r.kind === "suspended") throw accountSuspended();
  if (r.kind !== "ok") throw unauthorized();
  return r.user;
}

export async function requireResearcher(req: Request): Promise<AuthUser> {
  const u = await requireUser(req);
  if (!u.isResearcher) throw researcherRequired();
  return u;
}

export async function requireAdmin(req: Request): Promise<AuthUser> {
  const u = await requireUser(req);
  if (!u.isAdmin) throw adminRequired();
  return u;
}

/** Researchers may act on bounties they created; admins on all. */
export function canManageBounty(u: AuthUser, createdBy: string | null): boolean {
  return u.isAdmin || (u.isResearcher && createdBy !== null && createdBy === u.id);
}
