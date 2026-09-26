/**
 * Account operations behind the /api/me and /api/admin routes: profile view, self-serve researcher
 * access, admin user management, data export and account deletion. All SQL runs on the API's own
 * connection; routes do authorization before calling in here.
 */
import { randomInt } from "node:crypto";
import { DEMO, type AdminUser, type Me, type ResearcherProfile } from "@groundtruth/shared";
import { HttpError, notFound } from "../api/http";
import type { AuthUser } from "../auth";
import type { Db } from "../db";
import { wallet } from "../db/repos/ledger";
import { toIso, toIsoOrNull } from "../db/types";
import type { ObjectStorage } from "../storage";
import type { AccountAuth } from "./authAdmin";

interface ProfileFull {
  id: string;
  email: string | null;
  display_name: string | null;
  is_researcher: boolean;
  is_admin: boolean;
  suspended_at: unknown;
  researcher_org: string | null;
  researcher_purpose: string | null;
  researcher_revoked_at: unknown;
  trust_score: number;
  created_at: unknown;
}

const PROFILE_COLS = `p.id, u.email, p.display_name, p.is_researcher, p.is_admin, p.suspended_at, p.researcher_org,
  p.researcher_purpose, p.researcher_revoked_at, p.trust_score, p.created_at`;

async function profileFull(db: Db, id: string): Promise<ProfileFull | null> {
  const rows = await db.query<ProfileFull>(
    `select ${PROFILE_COLS} from public.profiles p left join auth.users u on u.id = p.id where p.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

function researcherProfile(p: Pick<ProfileFull, "researcher_org" | "researcher_purpose">): ResearcherProfile | null {
  return p.researcher_org && p.researcher_purpose ? { organization: p.researcher_org, purpose: p.researcher_purpose } : null;
}

export async function getMe(db: Db, user: AuthUser): Promise<Me> {
  const p = await profileFull(db, user.id);
  if (!p) throw notFound("Account not found");
  const w = await wallet(db, user.id);
  return {
    id: p.id,
    email: p.email ?? user.email,
    display_name: p.display_name,
    is_contributor: true,
    is_researcher: p.is_researcher,
    is_admin: p.is_admin,
    suspended: p.suspended_at !== null,
    researcher_profile: researcherProfile(p),
    trust_score: p.trust_score,
    balance_cents: w.balance_cents,
    created_at: toIso(p.created_at),
  };
}

/** Sign-up profile fields (the auth trigger already created the row). */
export async function initProfile(db: Db, id: string, displayName: string): Promise<void> {
  await db.query(
    "update public.profiles set display_name = $2, is_adult = true, consent_license = true, updated_at = now() where id = $1",
    [id, displayName],
  );
}

export async function enableResearcher(db: Db, id: string, rp: ResearcherProfile): Promise<void> {
  const p = await profileFull(db, id);
  if (!p) throw notFound("Account not found");
  if (p.researcher_revoked_at !== null && p.researcher_revoked_at !== undefined) {
    throw new HttpError(403, "RESEARCHER_REVOKED", "An administrator turned off researcher access for this account. Contact the GroundTruth team.");
  }
  await db.query(
    `update public.profiles set is_researcher = true, researcher_org = $2, researcher_purpose = $3,
       researcher_since = coalesce(researcher_since, now()), updated_at = now() where id = $1`,
    [id, rp.organization, rp.purpose],
  );
}

export async function disableResearcher(db: Db, id: string): Promise<void> {
  await db.query("update public.profiles set is_researcher = false, researcher_since = null, updated_at = now() where id = $1", [id]);
}

// ---------------------------------------------------------------- admin

function toAdminUser(r: ProfileFull & { submissions: number }): AdminUser {
  return {
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    is_researcher: r.is_researcher,
    is_admin: r.is_admin,
    suspended: r.suspended_at !== null,
    researcher_profile: researcherProfile(r),
    trust_score: r.trust_score,
    submissions: Number(r.submissions),
    created_at: toIso(r.created_at),
  };
}

const ADMIN_SELECT = `select ${PROFILE_COLS},
    (select count(*)::int from public.submissions s where s.user_id = p.id) as submissions
  from public.profiles p left join auth.users u on u.id = p.id`;

export async function listUsers(db: Db, q: string | undefined, limit: number): Promise<AdminUser[]> {
  const params: (string | number)[] = [DEMO.deletedUserId];
  // Anonymous legacy users are not accounts; the placeholder isn't a person.
  let where = "p.id <> $1 and coalesce(u.is_anonymous, false) = false";
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const i = params.length;
    where += ` and (u.email ilike $${i} or p.display_name ilike $${i} or p.researcher_org ilike $${i} or p.id::text = lower($${i + 1}))`;
    params.push(q);
  }
  params.push(limit);
  const rows = await db.query<ProfileFull & { submissions: number }>(
    `${ADMIN_SELECT} where ${where} order by p.created_at desc limit $${params.length}`,
    params,
  );
  return rows.map(toAdminUser);
}

export async function getAdminUser(db: Db, id: string): Promise<AdminUser | null> {
  if (id === DEMO.deletedUserId) return null;
  const rows = await db.query<ProfileFull & { submissions: number }>(`${ADMIN_SELECT} where p.id = $1`, [id]);
  return rows[0] ? toAdminUser(rows[0]) : null;
}

export interface UserPatch {
  is_researcher?: boolean | undefined;
  is_admin?: boolean | undefined;
  suspended?: boolean | undefined;
}

export async function patchUser(db: Db, actor: AuthUser, id: string, patch: UserPatch): Promise<AdminUser> {
  if (id === DEMO.deletedUserId) throw notFound("User not found");
  if (actor.id === id && (patch.is_admin === false || patch.suspended === true)) {
    throw new HttpError(409, "CANNOT_CHANGE_SELF", "You can't remove your own admin access or suspend yourself. Ask another admin.");
  }
  const existing = await getAdminUser(db, id);
  if (!existing) throw notFound("User not found");
  const sets: string[] = [];
  if (patch.is_admin !== undefined) sets.push(`is_admin = ${patch.is_admin ? "true" : "false"}`);
  if (patch.is_researcher === true) {
    // An admin grant also clears an earlier admin revoke.
    sets.push("is_researcher = true", "researcher_revoked_at = null", "researcher_since = coalesce(researcher_since, now())");
  } else if (patch.is_researcher === false) {
    // An admin revoke sticks: the user can't turn self-serve researcher access back on.
    sets.push("is_researcher = false", "researcher_revoked_at = now()", "researcher_since = null");
  }
  if (patch.suspended === true) sets.push("suspended_at = coalesce(suspended_at, now())");
  else if (patch.suspended === false) sets.push("suspended_at = null");
  if (sets.length > 0) await db.query(`update public.profiles set ${sets.join(", ")}, updated_at = now() where id = $1`, [id]);
  return (await getAdminUser(db, id))!;
}

const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** 16 characters from an unambiguous alphabet (no 0/O, 1/l/I) — it gets read out or typed by hand. */
export function temporaryPassword(len = 16): string {
  let s = "";
  for (let i = 0; i < len; i++) s += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return s;
}

export async function resetPassword(db: Db, auth: AccountAuth, id: string): Promise<string> {
  if (!(await getAdminUser(db, id))) throw notFound("User not found");
  const pw = temporaryPassword();
  await auth.setPassword(id, pw);
  return pw;
}

// ---------------------------------------------------------------- data rights

const EXPORT_URL_TTL = 15 * 60;

/** Everything we hold about the caller: profile, capture sessions, submissions (+ checks, signed photo URLs), ledger. */
export async function exportAccount(db: Db, storage: ObjectStorage, user: AuthUser, origin: string): Promise<Record<string, unknown>> {
  const me = await getMe(db, user);
  const profile = await db.query<Record<string, unknown>>(
    `select display_name, occupation, skills, interests, languages, regular_areas, notification_prefs, trust_score, is_adult,
            consent_license, onboarding, is_researcher, is_admin, researcher_org, researcher_purpose, researcher_since,
            created_at, updated_at
       from public.profiles where id = $1`,
    [user.id],
  );
  const sessions = await db.query<Record<string, unknown>>(
    `select id, bounty_id, cell, start_lat, start_lng, price_quote_cents, started_at, expires_at, status::text as status,
            frame_checks, gate_passed_at
       from public.capture_sessions where user_id = $1 order by started_at desc`,
    [user.id],
  );
  const subs = await db.query<Record<string, unknown>>(
    `select s.id, s.session_id, s.bounty_id, b.title as bounty_title, s.media, s.lat, s.lng, s.accuracy_m, s.h3_cell,
            s.captured_at, s.received_at, s.device, s.sensors, s.gate, s.field_notes, s.status::text as status, s.checks,
            s.reason_codes, s.confidence, s.protocol_score, s.authenticity_score, s.extracted, s.payout_cents, s.verifier,
            s.reviewed_at, s.review_note, s.media_purged_at
       from public.submissions s left join public.bounties b on b.id = s.bounty_id
      where s.user_id = $1 order by s.received_at desc`,
    [user.id],
  );
  const submissions = await Promise.all(
    subs.map(async (s) => {
      const media = Array.isArray(s.media) ? (s.media as { path: string }[]) : [];
      const urls = s.media_purged_at
        ? []
        : await Promise.all(
            media.map((m) =>
              storage.signedRead(m.path, origin, EXPORT_URL_TTL).catch(() => null),
            ),
          );
      return { ...s, media_urls: urls };
    }),
  );
  const w = await wallet(db, user.id);
  return {
    exported_at: new Date().toISOString(),
    note: `Photo links expire ${EXPORT_URL_TTL / 60} minutes after export. Download them now if you want copies.`,
    account: me,
    profile: profile[0] ?? null,
    capture_sessions: sessions.map((r) => ({ ...r, started_at: toIsoOrNull(r.started_at), expires_at: toIsoOrNull(r.expires_at), gate_passed_at: toIsoOrNull(r.gate_passed_at) })),
    submissions,
    ledger: { balance_cents: w.balance_cents, entries: w.entries },
  };
}

/** Rows that are (or may be) in the open dataset: accepted with a quality tier (provenance.ts). */
const PUBLISHABLE = `status = 'accepted' and (verifier = 'human' or (verifier = 'model' and confidence >= 0.75))`;

/**
 * Deletes an account.
 * 1. Every photo of theirs is deleted from storage first (if that fails nothing else has changed).
 * 2. Accepted, publishable observations stay in the open dataset (released under CC BY 4.0) but are
 *    reassigned to the deleted-user placeholder, with photos marked purged and device/sensor data
 *    cleared. Everything else of theirs (other submissions, sessions, ledger) is deleted.
 * 3. The auth user is deleted, which cascades the profile. Idempotent: if step 3 fails, retrying
 *    finds nothing left to move and tries the auth deletion again.
 */
export async function deleteAccount(db: Db, storage: ObjectStorage, auth: AccountAuth, userId: string): Promise<{ kept: number; deleted: number; photos: number }> {
  if (userId === DEMO.deletedUserId) throw notFound("Account not found");
  const media = await db.query<{ path: string }>(
    `select distinct m->>'path' as path from public.submissions s, jsonb_array_elements(s.media) m
      where s.user_id = $1 and s.media_purged_at is null
     union
     select distinct unnest(upload_paths) from public.capture_sessions where user_id = $1`,
    [userId],
  );
  // Only the caller's own folder: a submission row can carry foreign paths (the pipeline rejects
  // them, but the row exists), and deleting through them would destroy someone else's photos.
  const own = `observations/${userId}/`;
  const photos = media.map((r) => r.path).filter((p): p is string => typeof p === "string" && p.startsWith(own) && !p.includes(".."));
  if (photos.length > 0) await storage.remove(photos);

  const { kept, deleted } = await db.tx(async (tx) => {
    const k = await tx.query<{ id: string }>(
      `update public.submissions
          set user_id = $2, session_id = null, media_purged_at = coalesce(media_purged_at, now()),
              device = '{}'::jsonb, sensors = '{}'::jsonb
        where user_id = $1 and ${PUBLISHABLE}
        returning id`,
      [userId, DEMO.deletedUserId],
    );
    const d = await tx.query<{ id: string }>("delete from public.submissions where user_id = $1 returning id", [userId]);
    await tx.query("delete from public.ledger_entries where user_id = $1", [userId]);
    await tx.query("delete from public.capture_sessions where user_id = $1", [userId]);
    await tx.query("delete from public.match_cache where user_id = $1", [userId]);
    return { kept: k.length, deleted: d.length };
  });
  await auth.deleteUser(userId);
  // The auth deletion cascades the profile; delete it explicitly too in case it didn't.
  await db.query("delete from public.profiles where id = $1", [userId]);
  return { kept, deleted, photos: photos.length };
}
