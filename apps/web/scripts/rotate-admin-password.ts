/**
 * Sets a new random password for the seeded admin (researcher@groundtruth.dev) on the Supabase project
 * in NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, and prints it ONCE. Nothing is written to
 * disk. The old password was committed to the repo before accounts landed, so run this once against
 * the hosted project:
 *   cd apps/web && npx tsx --env-file=.env scripts/rotate-admin-password.ts
 * Optionally ADMIN_PASSWORD=<your own, 16+ chars> to choose it instead of a random one.
 */
import { randomBytes } from "node:crypto";
import { DEMO } from "@groundtruth/shared";
import { createClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env)");
  const chosen = process.env.ADMIN_PASSWORD?.trim();
  if (chosen && chosen.length < 16) throw new Error("ADMIN_PASSWORD must be at least 16 characters");
  const password = chosen || randomBytes(18).toString("base64url");

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: found, error: getErr } = await sb.auth.admin.getUserById(DEMO.researcherId);
  if (getErr || !found.user) throw new Error(`admin user ${DEMO.researcherId} not found: ${getErr?.message ?? "no user"}`);
  if (found.user.email !== DEMO.researcherEmail) {
    throw new Error(`user ${DEMO.researcherId} has email ${found.user.email ?? "(none)"}, expected ${DEMO.researcherEmail}; refusing`);
  }
  const { error } = await sb.auth.admin.updateUserById(DEMO.researcherId, { password });
  if (error) throw new Error(`password update failed: ${error.message}`);

  console.log(`Rotated the password of ${DEMO.researcherEmail} on ${new URL(url).host}.`);
  if (chosen) console.log("New password: the ADMIN_PASSWORD you supplied.");
  else console.log(`New password (shown once, store it in your password manager now): ${password}`);
  console.log(
    "Existing sign-ins are NOT revoked by a password change (refresh tokens keep working). To end them all: " +
      "Supabase SQL editor → delete from auth.sessions where user_id = '" + DEMO.researcherId + "';",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
