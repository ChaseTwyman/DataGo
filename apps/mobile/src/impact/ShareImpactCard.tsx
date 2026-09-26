/**
 * "Share impact card" on an accepted result: the server composes a branded card (no photo, no
 * precise place, no personal data), the phone downloads it to its cache and opens the iOS share
 * sheet (React Native's Share; no extra native module).
 */
import { File, Paths } from "expo-file-system";
import { useState } from "react";
import { Pressable, Share, View } from "react-native";
import { api } from "../api";
import { toUserMessage } from "../api/errors";
import { log } from "../lib/log";
import { Button, Label, StatusPill } from "../ui/components";
import { C, S, TOUCH } from "../ui/theme";

export function ShareImpactCard({ submissionId }: { submissionId: string }) {
  const [busy, setBusy] = useState<"plain" | "ai" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const share = async (ai: boolean) => {
    if (busy) return;
    setBusy(ai ? "ai" : "plain");
    setError(null);
    setNote(null);
    try {
      const card = await api.impactCard(submissionId, ai);
      if (card.note) setNote(card.note);
      const dest = new File(Paths.cache, `groundtruth-impact-${submissionId}${card.ai_background ? "-ai" : ""}.jpg`);
      if (dest.exists) dest.delete();
      const file = await File.downloadFileAsync(card.url, dest);
      await Share.share({ url: file.uri, message: "My verified GroundTruth reading · open data (CC BY 4.0)" });
    } catch (e) {
      log.handled("impact-card", e);
      setError(toUserMessage(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: S.sm }}>
      <Button title="Share impact card" kind="secondary" icon="share" onPress={() => void share(false)} loading={busy === "plain"} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share an impact card with an AI-generated background"
        onPress={() => void share(true)}
        disabled={busy !== null}
        style={{ minHeight: TOUCH, justifyContent: "center", alignSelf: "center" }}
      >
        <Label color={busy === "ai" ? C.muted : C.accent}>{busy === "ai" ? "Making the AI background…" : "Try an AI background (labelled)"}</Label>
      </Pressable>
      {note ? <StatusPill tone="neutral" icon="info" text={note} /> : null}
      {error ? <StatusPill tone="warn" icon="alert-triangle" text={error} /> : null}
    </View>
  );
}
