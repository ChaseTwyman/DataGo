/** Test harness: in-memory PGlite with the real migrations + seed, temp-dir storage, dev auth. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { openPglite, type PgliteHandle } from "@/lib/db/pglite";
import { setDbForTests, type Db } from "@/lib/db";
import { ensureDevUser } from "@/lib/db/repos/profiles";
import { LocalStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { devTokenFor } from "@/lib/auth";

export interface TestEnv {
  db: Db;
  handle: PgliteHandle;
  storage: LocalStorage;
  dir: string;
  close(): Promise<void>;
}

export async function setupTestEnv(): Promise<TestEnv> {
  const handle = await openPglite();
  const dir = mkdtempSync(join(tmpdir(), "gt-test-"));
  const storage = new LocalStorage(join(dir, "storage"));
  setDbForTests(handle.db);
  setStorageForTests(storage);
  return {
    db: handle.db,
    handle,
    storage,
    dir,
    async close() {
      setDbForTests(null);
      setStorageForTests(null);
      await handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function newContributor(db: Db): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  await ensureDevUser(db, id, "contributor");
  return { id, token: devTokenFor(id) };
}

export function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: Buffer } = {},
): Request {
  const headers: Record<string, string> = { host: "localhost:3000", ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.raw) {
    body = new Uint8Array(opts.raw);
    headers["content-type"] ??= "image/jpeg";
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  return new Request(`http://localhost:3000${path}`, { method, headers, body });
}

export const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Random blocky JPEG: perceptually unique per call (so dHash never collides across tests). */
export async function randomJpeg(width = 640, height = 480, seed = Math.random()): Promise<Buffer> {
  let a = Math.floor(seed * 2 ** 32) >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const block = 40;
  const cols = Math.ceil(width / block);
  const raw = Buffer.alloc(width * height * 3);
  const colors = Array.from({ length: cols * Math.ceil(height / block) }, () => [rand() * 255, rand() * 255, rand() * 255]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = colors[Math.floor(y / block) * cols + Math.floor(x / block)]!;
      const o = (y * width + x) * 3;
      raw[o] = c[0]!;
      raw[o + 1] = c[1]!;
      raw[o + 2] = c[2]!;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}
