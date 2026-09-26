import type { VoiceTokenResponse } from "@groundtruth/shared";
import { grokUnavailable, json, route } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { mintVoiceToken } from "@/lib/grok/voiceToken";

/** Ephemeral realtime voice token (M0.5). The phone connects to xAI directly; the API key stays here. */
export const POST = route(async (req) => {
  await requireUser(req);
  let t;
  try {
    t = await mintVoiceToken();
  } catch (err) {
    throw grokUnavailable(err, "voice token");
  }
  const body: VoiceTokenResponse = { token: t.token, expires_at: t.expiresAt, model: t.model, url: t.url };
  return json(body, { headers: { "cache-control": "no-store" } });
});
