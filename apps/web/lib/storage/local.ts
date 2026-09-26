import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { localSigningSecret } from "../env";
import { splitPath, type ObjectStorage, type SignedUploadTarget } from "./types";

export type LocalOp = "upload" | "read";

function sign(op: LocalOp, path: string, exp: number): string {
  return createHmac("sha256", localSigningSecret()).update(`${op}\n${path}\n${exp}`).digest("base64url");
}

export function makeLocalToken(op: LocalOp, path: string, ttlSeconds: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${exp}.${sign(op, path, exp)}`;
}

export function verifyLocalToken(op: LocalOp, path: string, token: string, now = Date.now()): boolean {
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  const want = Buffer.from(sign(op, path, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export class LocalStorage implements ObjectStorage {
  readonly root: string;
  constructor(root?: string) {
    this.root = resolve(root ?? process.env.LOCAL_STORAGE_DIR ?? join(process.env.LOCAL_DATA_DIR || join(process.cwd(), ".local"), "storage"));
  }

  file(path: string): string {
    const { bucket, key } = splitPath(path);
    return join(this.root, bucket, ...key.split("/"));
  }

  async put(path: string, bytes: Buffer): Promise<void> {
    const f = this.file(path);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, bytes);
  }

  async get(path: string): Promise<Buffer> {
    return readFile(this.file(path));
  }

  async exists(path: string): Promise<boolean> {
    try {
      return (await stat(this.file(path))).isFile();
    } catch {
      return false;
    }
  }

  async signedUpload(path: string, origin: string): Promise<SignedUploadTarget> {
    splitPath(path);
    const token = makeLocalToken("upload", path, 2 * 3600);
    return {
      signed_url: `${origin}/api/dev/upload?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`,
      token,
    };
  }

  async signedRead(path: string, origin: string, ttlSeconds = 3600): Promise<string> {
    splitPath(path);
    const token = makeLocalToken("read", path, ttlSeconds);
    return `${origin}/api/dev/media?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
  }
}
