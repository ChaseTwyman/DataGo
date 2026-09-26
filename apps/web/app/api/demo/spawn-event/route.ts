import { SpawnEventRequestSchema, type SpawnEventResponseSchema } from "@groundtruth/shared";
import type { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { spawnDemoEvent } from "@/lib/demo";
import { isDemoMode } from "@/lib/env";
import { getStorage } from "@/lib/storage";

export const maxDuration = 120;

/** DEMO_MODE only: active flood bounty centered at the venue, event 20 min old, seeded neighbours. */
export const POST = route(async (req) => {
  if (!isDemoMode()) throw new HttpError(404, "NOT_FOUND", "Not found");
  // Admin-only: a demo event is funded outside the pool (recorded as a sponsor contribution).
  const user = await requireAdmin(req);
  const body = await parseBody(req, SpawnEventRequestSchema);
  const res: z.infer<typeof SpawnEventResponseSchema> = await spawnDemoEvent(await getDb(), getStorage(), {
    lat: body.lat,
    lng: body.lng,
    radius_m: body.radius_m,
    createdBy: user.id,
  });
  return json(res, { status: 201 });
});
