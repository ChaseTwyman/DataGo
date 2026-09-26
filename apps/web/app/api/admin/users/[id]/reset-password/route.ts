import { Uuid, type AdminResetPasswordResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { json, route, type IdParams } from "@/lib/api/http";
import { getAccountAuth } from "@/lib/account/authAdmin";
import { resetPassword } from "@/lib/account/service";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * Admin: sets a random 16-character temporary password and returns it once (no email is ever sent;
 * the admin hands it over). The user should change it under Account settings.
 */
export const POST = route<IdParams>(async (req, { params }) => {
  const actor = await requireAdmin(req);
  const id = Uuid.parse((await params).id);
  const temporary_password = await resetPassword(await getDb(), getAccountAuth(), id);
  console.info(`[admin] ${actor.id} reset the password of ${id}`);
  const body: z.infer<typeof AdminResetPasswordResponseSchema> = { temporary_password };
  return json(body, { headers: { "cache-control": "no-store" } });
});
