/**
 * Grok Imagine "ideal shot" per protocol (PRD §7.3). Stored in the `synthetic` bucket, tracked in
 * synthetic_media, and always rendered with an "EXAMPLE — AI-generated" label by clients.
 */
import type { Db } from "./db";
import { setExampleImagePath, type ProtocolRow } from "./db/repos/protocols";
import { insertSyntheticMedia } from "./db/repos/redteam";
import { grokEnv } from "./grok/config";
import { grokImage } from "./grok/imagine";
import type { ObjectStorage } from "./storage";

export const EXAMPLE_LABEL = "EXAMPLE — AI-generated";

export function examplePath(p: Pick<ProtocolRow, "slug" | "version">): string {
  return `synthetic/examples/${p.slug}-v${p.version}.jpg`;
}

export async function generateExampleImage(
  db: Db,
  storage: ObjectStorage,
  protocol: ProtocolRow,
  opts: { force?: boolean } = {},
): Promise<{ path: string; generated: boolean }> {
  const path = examplePath(protocol);
  if (!opts.force && protocol.example_image_path && (await storage.exists(protocol.example_image_path))) {
    return { path: protocol.example_image_path, generated: false };
  }
  const prompt = protocol.definition.example_image_prompt;
  const bytes = await grokImage({ prompt, aspectRatio: "16:9" });
  await storage.put(path, bytes, "image/jpeg");
  await insertSyntheticMedia(db, { kind: "example", path, prompt, model: grokEnv.imageModel });
  await setExampleImagePath(db, protocol.id, path);
  return { path, generated: true };
}
