import type { ProfileRequest, Role } from "@groundtruth/shared";
import { json, type Db } from "../types";

export interface ProfileRow {
  id: string;
  role: Role;
  display_name: string | null;
  trust_score: number;
  is_researcher: boolean;
  is_admin: boolean;
  suspended_at: string | null;
}

export async function getProfile(db: Db, id: string): Promise<ProfileRow | null> {
  const rows = await db.query<ProfileRow>(
    "select id, role::text as role, display_name, trust_score, is_researcher, is_admin, suspended_at::text as suspended_at from public.profiles where id = $1",
    [id],
  );
  return rows[0] ?? null;
}

/**
 * LOCAL_BACKEND only: create a real (non-anonymous) dev account dev+<id>@local; the trigger
 * creates the profile. researcher → is_researcher; admin → is_admin + is_researcher.
 */
export async function ensureDevUser(db: Db, id: string, role: Role = "contributor"): Promise<ProfileRow> {
  await db.query(
    "insert into auth.users (id, is_anonymous, role, aud, email, email_confirmed_at) values ($1, false, 'authenticated', 'authenticated', $2, now()) on conflict (id) do nothing",
    [id, `dev+${id}@local`],
  );
  // Adult + license consent: a dev account stands in for a completed sign-up.
  await db.query("update public.profiles set is_adult = true, consent_license = true where id = $1 and not is_adult", [id]);
  if (role !== "contributor") {
    await db.query(
      "update public.profiles set is_researcher = true, is_admin = (is_admin or $2), researcher_since = coalesce(researcher_since, now()) where id = $1",
      [id, role === "admin"],
    );
  }
  const p = await getProfile(db, id);
  if (!p) throw new Error("dev user profile missing");
  return p;
}

export async function updateProfile(db: Db, id: string, p: ProfileRequest): Promise<ProfileRow> {
  const sets: string[] = [];
  const params: (string | boolean | string[] | null)[] = [id];
  const add = (col: string, val: string | boolean | string[] | null, cast = "") => {
    params.push(val);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (p.display_name !== undefined) add("display_name", p.display_name);
  if (p.occupation !== undefined) add("occupation", p.occupation);
  if (p.skills !== undefined) add("skills", p.skills, "::text[]");
  if (p.interests !== undefined) add("interests", p.interests, "::text[]");
  if (p.languages !== undefined) add("languages", p.languages, "::text[]");
  if (p.regular_areas !== undefined) add("regular_areas", json(p.regular_areas), "::jsonb");
  if (p.notification_prefs !== undefined) add("notification_prefs", json(p.notification_prefs), "::jsonb");
  if (p.is_adult !== undefined) add("is_adult", p.is_adult);
  if (p.consent_license !== undefined) add("consent_license", p.consent_license);
  if (sets.length > 0) {
    await db.query(`update public.profiles set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
  }
  const out = await getProfile(db, id);
  if (!out) throw new Error("profile not found");
  return out;
}

export async function setTrust(db: Db, id: string, trust: number): Promise<void> {
  await db.query("update public.profiles set trust_score = $2, updated_at = now() where id = $1", [id, trust]);
}
