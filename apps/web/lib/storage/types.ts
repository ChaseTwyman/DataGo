export const BUCKETS = ["observations", "synthetic"] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface SignedUploadTarget {
  signed_url: string;
  token: string;
}

export interface ObjectStorage {
  put(path: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  /** URL the phone PUTs raw bytes to (Content-Type: image/jpeg). `origin` = this server's origin. */
  signedUpload(path: string, origin: string): Promise<SignedUploadTarget>;
  /** Deletes objects; missing ones are ignored. */
  remove(paths: string[]): Promise<void>;
  /** Short-lived read URL. */
  signedRead(path: string, origin: string, ttlSeconds?: number): Promise<string>;
}

export class StoragePathError extends Error {}

/** Splits a bucket-qualified path. Rejects unknown buckets and traversal. */
export function splitPath(path: string): { bucket: Bucket; key: string } {
  const [bucket, ...rest] = path.split("/");
  const key = rest.join("/");
  if (!BUCKETS.includes(bucket as Bucket)) throw new StoragePathError(`unknown bucket in path: ${path}`);
  if (!key || key.split("/").some((seg) => seg === ".." || seg === "." || seg === "") || key.includes("\\")) {
    throw new StoragePathError(`invalid storage path: ${path}`);
  }
  return { bucket: bucket as Bucket, key };
}
