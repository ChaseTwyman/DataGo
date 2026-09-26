import { AdminUserPatchSchema, Uuid } from "@groundtruth/shared";
import { json, parseBody, route, type IdParams } from "@/lib/api/http";
import { patchUser } from "@/lib/account/service";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Admin: toggle researcher / admin / suspended. An admin can't remove their own admin flag or suspend themselves. */
export const PATCH = route<IdParams>(async (req, { params }) => {
  const actor = await requireAdmin(req);
  const id = Uuid.parse((await params).id);
  const patch = await parseBody(req, AdminUserPatchSchema);
  return json(await patchUser(await getDb(), actor, id, patch));
});
