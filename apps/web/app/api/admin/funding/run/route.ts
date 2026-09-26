import type { RunAllocationResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { json, route } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { runAllocation } from "@/lib/funding/allocation";

/** Admin: run the allocation engine now (release ended requests, fund pending ones oldest first). */
export const POST = route(async (req) => {
  await requireAdmin(req);
  const res: z.infer<typeof RunAllocationResponseSchema> = await runAllocation(await getDb());
  return json(res);
});
