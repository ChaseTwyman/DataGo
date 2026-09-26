import { assertLocalBackend } from "@/lib/api/devOnly";
import { HttpError, json, route } from "@/lib/api/http";
import { getStorage } from "@/lib/storage";
import { verifyLocalToken } from "@/lib/storage/local";

const MAX_BYTES = 15 * 1024 * 1024;

/** LOCAL_BACKEND=1 only: target of the signed upload URL. The phone PUTs raw JPEG bytes. */
async function handle(req: Request): Promise<Response> {
  assertLocalBackend();
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!verifyLocalToken("upload", path, token)) throw new HttpError(403, "BAD_SIGNATURE", "Invalid or expired upload URL");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, "EMPTY_BODY", "Upload body is empty");
  if (bytes.length > MAX_BYTES) throw new HttpError(413, "TOO_LARGE", "Upload exceeds 15 MB");
  await getStorage().put(path, bytes, req.headers.get("content-type") ?? "image/jpeg");
  return json({ path, bytes: bytes.length });
}

export const PUT = route(handle);
export const POST = route(handle);
