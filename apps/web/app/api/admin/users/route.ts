import { AdminUserQuerySchema, type AdminUserListResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { json, parseQuery, route } from "@/lib/api/http";
import { listUsers } from "@/lib/account/service";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Admin: accounts, newest first; q matches email, name, organization, or exact id. */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const q = parseQuery(req, AdminUserQuerySchema);
  const body: z.infer<typeof AdminUserListResponseSchema> = { users: await listUsers(await getDb(), q.q || undefined, q.limit) };
  return json(body);
});
