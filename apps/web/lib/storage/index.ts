/**
 * Object storage behind one interface. Paths are always bucket-qualified
 * ("observations/<user>/<session>/0.jpg", "synthetic/examples/x.jpg"); adapters strip the bucket.
 * LOCAL_BACKEND=1 → files under apps/web/.local/storage with HMAC-signed /api/dev/* URLs.
 * Otherwise → Supabase Storage.
 */
import { isLocalBackend } from "../env";
import { LocalStorage } from "./local";
import { SupabaseStorage } from "./supabase";
import type { ObjectStorage } from "./types";

export * from "./types";

const g = globalThis as typeof globalThis & { __gtStorage?: { override: ObjectStorage | null; inst: ObjectStorage | null } };
const cache = (g.__gtStorage ??= { override: null, inst: null });

export function getStorage(): ObjectStorage {
  if (cache.override) return cache.override;
  if (!cache.inst) cache.inst = isLocalBackend() ? new LocalStorage() : new SupabaseStorage();
  return cache.inst;
}

export function setStorageForTests(s: ObjectStorage | null): void {
  cache.override = s;
}
