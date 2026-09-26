import { originOf, route } from "@/lib/api/http";
import { exportAccount } from "@/lib/account/service";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";

/** "Download my data": JSON attachment with profile, sessions, submissions (+ signed photo URLs), ledger. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const data = await exportAccount(await getDb(), getStorage(), user, originOf(req));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="groundtruth-my-data-${day}.json"`,
      "cache-control": "no-store",
    },
  });
});
