/**
 * M0.5 voice spike: connect → talk → hear Grok. Shows both captions, the speech-end → first-audio
 * latency for every turn, and any unknown server event types (to adapt the parser on device).
 */
import { ScrollView, Text, View } from "react-native";
import { Button, Card, H, Muted, StatusPill, type Tone } from "../src/ui/components";
import { C, S } from "../src/ui/theme";
import { useGrokVoice } from "../src/voice/useGrokVoice";
import { CaptionList } from "../src/voice/CaptionList";

const TONE: Record<string, Tone> = { idle: "neutral", connecting: "info", open: "ok", closed: "neutral", error: "bad" };

export default function VoiceTest() {
  const v = useGrokVoice({ mode: { kind: "test" } });
  const live = v.status === "open" || v.status === "connecting";
  const avg = v.latencies.length ? Math.round(v.latencies.reduce((a, b) => a + b, 0) / v.latencies.length) : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, gap: S.lg }}>
      <Card style={{ gap: S.md }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <H>Grok Voice</H>
          <StatusPill tone={TONE[v.status] ?? "neutral"} text={v.status} />
        </View>
        <Muted>Say hello and wait for the reply. Then talk over the reply: playback should stop at once (barge-in).</Muted>
        <Button
          title={live ? "Disconnect" : "Connect"}
          kind={live ? "danger" : "primary"}
          icon={live ? "■" : "●"}
          onPress={() => (live ? void v.disconnect() : void v.connect())}
        />
        {v.error ? <StatusPill tone="bad" text={v.error} /> : null}
      </Card>

      <Card style={{ gap: S.sm }}>
        <H size={16}>Latency (speech end → first audio)</H>
        <View style={{ flexDirection: "row", gap: S.xl }}>
          <Metric label="last" value={v.lastLatency === null ? "—" : `${v.lastLatency} ms`} good={v.lastLatency !== null && v.lastLatency < 1500} />
          <Metric label="avg" value={avg === null ? "—" : `${avg} ms`} good={avg !== null && avg < 1500} />
          <Metric label="turns" value={String(v.latencies.length)} />
        </View>
        <StatusPill tone={v.agentSpeaking ? "info" : "neutral"} text={v.agentSpeaking ? "Grok speaking" : "Listening"} />
      </Card>

      <Card style={{ gap: S.sm, minHeight: 200 }}>
        <H size={16}>Captions</H>
        <CaptionList captions={v.captions} max={20} />
      </Card>

      {v.unknownEvents.length ? (
        <Card style={{ gap: S.xs }}>
          <H size={16}>Unknown server events</H>
          {v.unknownEvents.map((t) => (
            <Text key={t} style={{ color: C.amber, fontFamily: "Menlo" }}>
              {t}
            </Text>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View>
      <Text style={{ color: good === undefined ? C.text : good ? C.green : C.amber, fontSize: 22, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <Muted>{label}</Muted>
    </View>
  );
}
