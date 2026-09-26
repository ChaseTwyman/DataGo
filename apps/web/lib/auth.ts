/**
 * Bearer auth for API routes.
 * - Supabase mode: `Authorization: Bearer <supabase access token>` → auth.getUser → profiles.role.
 * - LOCAL_BACKEND=1: additionally accepts `dev.<uuid>` tokens minted by POST /api/dev/session.
 *   Dev tokens are refused outright when LOCAL_BACKEND is off (tested in test/auth.test.ts).
 */
import { DEV_TOKEN_PREFIX, type Role } from "@groundtruth/shared";
import { forbidden, unauthorized } from "./api/http";
import { getDb } from "./db";
import { getProfile } from "./db/repos/profiles";
import { isLocalBackend } from "./env";
import { supabaseAdmin } from "./supabase/admin";

export interface AuthUser {
  id: string;
  role: Role;
  trustScore: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

export function devTokenFor(userId: string): string {
  return `${DEV_TOKEN_PREFIX}${userId}`;
}

/** Resolves the caller's user id from the token, or null. Never throws for bad tokens. */
export async function userIdFromToken(token: string): Promise<string | null> {
  if (token.startsWith(DEV_TOKEN_PREFIX)) {
    if (!isLocalBackend()) return null;
    const id = token.slice(DEV_TOKEN_PREFIX.length);
    return UUID_RE.test(id) ? id.toLowerCase() : null;
  }
  if (isLocalBackend()) return null; // no Supabase Auth in local mode
  try {
    const { data, error } = await supabaseAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export async function getAuth(req: Request): Promise<AuthUser | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const id = await userIdFromToken(token);
  if (!id) return null;
  const profile = await getProfile(await getDb(), id);
  if (!profile) return null;
  return { id, role: profile.role, trustScore: profile.trust_score };
}

export async function requireUser(req: Request): Promise<AuthUser> {
  const u = await getAuth(req);
  if (!u) throw unauthorized();
  return u;
}

export const isResearcherRole = (r: Role) => r === "researcher" || r === "admin";

export async function requireResearcher(req: Request): Promise<AuthUser> {
  const u = await requireUser(req);
  if (!isResearcherRole(u.role)) throw forbidden("Researcher or admin role required");
  return u;
}

/** Researchers may act on bounties they created; admins on all. */
export function canManageBounty(u: AuthUser, createdBy: string | null): boolean {
  return u.role === "admin" || (u.role === "researcher" && createdBy === u.id);
}
