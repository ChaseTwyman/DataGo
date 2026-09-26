import { assertLocalBackend } from "@/lib/api/devOnly";
import { HttpError, route } from "@/lib/api/http";
import { getStorage } from "@/lib/storage";
import { verifyLocalToken } from "@/lib/storage/local";

/** LOCAL_BACKEND=1 only: target of signed read URLs. */
export const GET = route(async (req) => {
  assertLocalBackend();
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!verifyLocalToken("read", path, token)) throw new HttpError(403, "BAD_SIGNATURE", "Invalid or expired media URL");
  let bytes: Buffer;
  try {
    bytes = await getStorage().get(path);
  } catch {
    throw new HttpError(404, "NOT_FOUND", "No such object");
  }
  const type = path.endsWith(".png") ? "image/png" : path.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
  return new Response(new Uint8Array(bytes), { headers: { "content-type": type, "cache-control": "private, max-age=300" } });
});
