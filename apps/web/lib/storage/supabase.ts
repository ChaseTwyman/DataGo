import { supabaseAdmin } from "../supabase/admin";
import { splitPath, type ObjectStorage, type SignedUploadTarget } from "./types";

export class SupabaseStorage implements ObjectStorage {
  async put(path: string, bytes: Buffer, contentType = "image/jpeg"): Promise<void> {
    const { bucket, key } = splitPath(path);
    const { error } = await supabaseAdmin().storage.from(bucket).upload(key, bytes, { contentType, upsert: true });
    if (error) throw new Error(`storage upload ${path}: ${error.message}`);
  }

  async get(path: string): Promise<Buffer> {
    const { bucket, key } = splitPath(path);
    const { data, error } = await supabaseAdmin().storage.from(bucket).download(key);
    if (error || !data) throw new Error(`storage download ${path}: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    const { bucket, key } = splitPath(path);
    const slash = key.lastIndexOf("/");
    const dir = slash >= 0 ? key.slice(0, slash) : "";
    const name = key.slice(slash + 1);
    const { data, error } = await supabaseAdmin().storage.from(bucket).list(dir, { search: name, limit: 10 });
    if (error) return false;
    return (data ?? []).some((o) => o.name === name);
  }

  async signedUpload(path: string): Promise<SignedUploadTarget> {
    const { bucket, key } = splitPath(path);
    const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUploadUrl(key, { upsert: true });
    if (error || !data) throw new Error(`signed upload ${path}: ${error?.message ?? "no data"}`);
    return { signed_url: data.signedUrl, token: data.token };
  }

  async signedRead(path: string, _origin: string, ttlSeconds = 3600): Promise<string> {
    const { bucket, key } = splitPath(path);
    if (bucket === "synthetic") return supabaseAdmin().storage.from(bucket).getPublicUrl(key).data.publicUrl;
    const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUrl(key, ttlSeconds);
    if (error || !data) throw new Error(`signed read ${path}: ${error?.message ?? "no data"}`);
    return data.signedUrl;
  }
}
