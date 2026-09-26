/**
 * M0.5 voice spike: connect → talk → hear Grok. Shows both captions, the speech-end → first-audio
 * latency for every turn, and any unknown server event types (to adapt the parser on device).
 */
import { Redirect } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { Body, Button, Divider, Readout, Section, StatusPill, type Tone } from "../src/ui/components";
import { C, S } from "../src/ui/theme";
import { CaptionList } from "../src/voice/CaptionList";
import { useGrokVoice } from "../src/voice/useGrokVoice";

const TONE: Record<string, Tone> = { idle: "neutral", connecting: "info", open: "ok", closed: "neutral", error: "bad" };

export { RouteErrorBoundary as ErrorBoundary } from "../src/ui/ErrorFallback";

/** Developer diagnostics: unreachable in Release builds (no entry point, and a deep link bounces). */
export default function VoiceTest() {
  if (!__DEV__) return <Redirect href="/map" />;
  return <VoiceTestInner />;
}

function VoiceTestInner() {
  const v = useGrokVoice({ mode: { kind: "test" } });
  const live = v.status === "open" || v.status === "connecting";
  const avg = v.latencies.length ? Math.round(v.latencies.reduce((a, b) => a + b, 0) / v.latencies.length) : null;
  const latColor = (ms: number | null) => (ms === null ? C.text : ms < 1500 ? C.green : C.amber);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, gap: S.xxl, paddingBottom: S.xxl }}>
      <Section title="Grok Voice" right={<StatusPill tone={TONE[v.status] ?? "neutral"} text={v.status} />}>
        <Body color={C.muted}>Say hello and wait for the reply. Then talk over the reply: playback should stop at once (barge-in).</Body>
        <Button
          title={live ? "Disconnect" : "Connect"}
          kind={live ? "danger" : "primary"}
          icon={live ? "square" : "mic"}
          onPress={() => (live ? void v.disconnect() : void v.connect())}
        />
        {v.error ? <StatusPill tone="bad" text={v.error} /> : null}
      </Section>

      <Section title="Latency · speech end → first audio" right={<StatusPill tone={v.agentSpeaking ? "info" : "neutral"} text={v.agentSpeaking ? "Grok speaking" : "Listening"} icon={v.agentSpeaking ? "volume-2" : "mic"} />}>
        <View style={{ flexDirection: "row", gap: S.xl }}>
          <Readout label="Last" value={v.lastLatency === null ? "—" : String(v.lastLatency)} unit={v.lastLatency === null ? undefined : "MS"} color={latColor(v.lastLatency)} />
          <Readout label="Avg" value={avg === null ? "—" : String(avg)} unit={avg === null ? undefined : "MS"} color={latColor(avg)} />
          <Readout label="Turns" value={String(v.latencies.length)} />
        </View>
        <Divider />
        <Body color={C.muted} size={15}>Target under 1500 ms (green). Amber means slower than target.</Body>
      </Section>

      <Section title="Captions">
        <View style={{ minHeight: 160 }}>
          <CaptionList captions={v.captions} max={20} />
        </View>
      </Section>

      {v.unknownEvents.length ? (
        <Section title="Unknown server events">
          {v.unknownEvents.map((t) => (
            <Text key={t} style={{ color: C.amber, fontFamily: "Menlo", fontSize: 14 }}>
              {t}
            </Text>
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}
