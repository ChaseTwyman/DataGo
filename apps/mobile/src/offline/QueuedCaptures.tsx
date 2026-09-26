/** Wallet section: captures saved on the phone while offline, and what happened to them. */
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Button, Label, Section, StatusPill, type Tone } from "../ui/components";
import { C, F, S, T, TOUCH } from "../ui/theme";
import type { QueuedCapture } from "./queue";
import { uploadQueue, useUploadQueue } from "./runtime";

const TONE: Record<QueuedCapture["status"], { tone: Tone; icon: "wifi-off" | "upload" | "check" | "x-circle" | "clock" }> = {
  waiting: { tone: "info", icon: "wifi-off" },
  sending: { tone: "info", icon: "upload" },
  sent: { tone: "ok", icon: "check" },
  failed: { tone: "bad", icon: "x-circle" },
  discarded: { tone: "warn", icon: "clock" },
};

export function QueuedCaptures() {
  const items = useUploadQueue((s) => s.items);
  if (items.length === 0) return null;
  const waiting = items.some((q) => q.status === "waiting");
  return (
    <Section title="Saved captures" right={waiting ? <Button title="Send now" kind="secondary" icon="refresh-cw" onPress={() => void uploadQueue.retryNow()} /> : undefined}>
      <View style={{ gap: S.md }}>
        {items.map((q) => {
          const t = TONE[q.status];
          const done = q.status !== "waiting" && q.status !== "sending";
          return (
            <View key={q.id} style={{ gap: S.xs }}>
              <Text style={{ color: C.text, fontFamily: F.bodyMedium, fontSize: T.body }} numberOfLines={1}>
                {q.bounty_title}
              </Text>
              <StatusPill tone={t.tone} icon={t.icon} text={q.message} />
              <View style={{ flexDirection: "row", gap: S.lg }}>
                <Label>{`Saved ${new Date(q.queued_at).toLocaleTimeString()}`}</Label>
                {q.status === "sent" && q.submission_id ? (
                  <Pressable accessibilityRole="link" onPress={() => router.push(`/result/${q.submission_id}`)} style={{ minHeight: TOUCH / 2 }}>
                    <Label color={C.accent}>See result</Label>
                  </Pressable>
                ) : null}
                {done ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => void uploadQueue.dismiss(q.id)} style={{ minHeight: TOUCH / 2 }}>
                    <Label>Dismiss</Label>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </Section>
  );
}
