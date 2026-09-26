import type { HealthResponse } from "@groundtruth/shared";
import { json, route } from "@/lib/api/http";
import { getDb } from "@/lib/db";
import { isDemoMode, isLocalBackend, isMockGrok } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Lets clients discover backend mode. Realtime needs Supabase; local clients poll GET /api/submissions/:id. */
export const GET = route(async () => {
  let ok = true;
  try {
    await (await getDb()).query("select 1");
  } catch (err) {
    ok = false;
    // Message only (e.g. "28P01 password authentication failed"); never the connection string.
    const e = err as { code?: string; message?: string };
    console.warn("[health] database unavailable:", e.code ?? "", e.message ?? String(err));
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
