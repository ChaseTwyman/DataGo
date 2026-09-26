import { DeleteAccountRequestSchema } from "@groundtruth/shared";
import { json, parseBody, route } from "@/lib/api/http";
import { getAccountAuth } from "@/lib/account/authAdmin";
import { deleteAccount, getMe } from "@/lib/account/service";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";

/** The caller's account: flags, researcher profile, trust, balance. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return json(await getMe(await getDb(), user));
});

/**
 * Deletes the caller's account ({ confirm: "DELETE" }). Photos, profile, wallet and sessions go;
 * accepted observations already in the open dataset stay, de-identified (see deleteAccount).
 */
export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  await parseBody(req, DeleteAccountRequestSchema);
  const r = await deleteAccount(await getDb(), getStorage(), getAccountAuth(), user.id);
  console.info(`[account] deleted ${user.id}: kept ${r.kept} de-identified, deleted ${r.deleted} submissions, ${r.photos} photos`);
  return new Response(null, { status: 204 });
});
