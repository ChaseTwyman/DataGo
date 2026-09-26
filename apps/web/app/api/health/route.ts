import type { HealthResponse } from "@groundtruth/shared";
import { json, route } from "@/lib/api/http";
import { getDb } from "@/lib/db";
import { isDemoMode, isLocalBackend, isMockGrok } from "@/lib/env";

/** Lets clients discover backend mode. Realtime needs Supabase; local clients poll GET /api/submissions/:id. */
export const GET = route(async () => {
  let ok = true;
  try {
    await (await getDb()).query("select 1");
  } catch {
    ok = false;
  }
  const local = isLocalBackend();
  const body: HealthResponse = {
    ok,
    backend: local ? "local" : "supabase",
    mock_grok: isMockGrok(),
    demo_mode: isDemoMode(),
    realtime: !local,
  };
  return json(body, { status: ok ? 200 : 503 });
});
