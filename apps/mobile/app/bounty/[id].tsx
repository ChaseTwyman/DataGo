/** Mission briefing (PRD §7.3): why it matters, safety, labeled AI example, locked-price note. */
import { formatCents, formatSurge, type CellPrice } from "@groundtruth/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../src/api";
import { toUserMessage } from "../../src/api/errors";
import { useBounty } from "../../src/api/queries";
import { log } from "../../src/lib/log";
import { LocationPermissionError, preciseFix } from "../../src/lib/useUserLocation";
import { useCaptureStore } from "../../src/state/captureStore";
import { Badge, Body, Button, Divider, ErrorBox, Heading, Icon, Label, LoadingState, Money, Muted, Readout, Section, SponsorLine, StatusPill, SurgeBadge } from "../../src/ui/components";
import { indexLabel, timeLeftReadout } from "../../src/ui/telemetry";
import { C, F, S, T } from "../../src/ui/theme";

function bestCell(cov: CellPrice[]): CellPrice | null {
  return [...cov].filter((c) => !c.paused).sort((a, b) => b.price_cents - a.price_cents)[0] ?? null;
}

export { RouteErrorBoundary as ErrorBoundary } from "../../src/ui/ErrorFallback";

export default function BountyBriefing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const q = useBounty(id);
  const put = useCaptureStore((s) => s.put);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ text: string; settings: boolean } | null>(null);

  if (q.error && !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: S.lg, gap: S.md }}>
        <ErrorBox title="Couldn't load the briefing" message={toUserMessage(q.error).message} onRetry={() => void q.refetch()} />
        <Button title="Back to bounties" kind="secondary" icon="arrow-left" onPress={() => (router.canGoBack() ? router.back() : router.replace("/foryou"))} />
      </View>
    );
  const b = q.data;
  if (!b)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center" }}>
        <LoadingState label="Loading briefing…" />
      </View>
    );
  const p = b.protocol;
  const top = bestCell(b.coverage);
  const allPaused = b.coverage.length > 0 && b.coverage.every((c) => c.paused);
  const openCells = b.coverage.filter((c) => !c.paused).length;

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const fix = await preciseFix();
      const session = await api.createSession({ bounty_id: b.id, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracyM ?? 999 });
      put({ session, bounty: b });
      router.push(`/capture/${session.session_id}`);
    } catch (e) {
      log.handled("start-capture", e);
      setStartError({ text: toUserMessage(e).message, settings: e instanceof LocationPermissionError });
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.xxl, paddingBottom: S.xxl }}>
        {/* hero */}
        <View style={{ gap: S.md }}>
          <Label>{p.name}</Label>
          <Heading size={T.heading}>{b.title}</Heading>
          {top ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: S.md, flexWrap: "wrap" }}>
              <Money cents={top.price_cents} size={T.numeralHero} />
              <SurgeBadge surge={top.surge} />
            </View>
          ) : null}
          {allPaused ? <StatusPill tone="bad" text="Paused · hazard warning" /> : null}
          <Divider />
          <View style={{ flexDirection: "row", gap: S.lg }}>
            <Readout label="Time left" value={timeLeftReadout(b.ends_at)} size={24} style={{ flex: 1 }} />
            <Readout label="Base" value={formatCents(b.base_price_cents)} size={24} style={{ flex: 1 }} />
            <Readout label="Max" value={formatCents(b.max_price_cents)} size={24} style={{ flex: 1 }} />
            <Readout label="Cells" value={`${openCells}/${b.coverage.length}`} size={24} style={{ flex: 1 }} />
          </View>
          <SponsorLine name={b.sponsor_name} url={b.sponsor_url} />
        </View>

        <Section index={0} title="Why it matters">
          <Body>{b.summary || p.why_it_matters}</Body>
          {b.summary ? <Muted>{p.why_it_matters}</Muted> : null}
        </Section>

        <Section index={1} title="Safety" right={<StatusPill tone="warn" text={p.safety.level} icon="shield" />}>
          <View style={styles.safety}>
            {p.safety.rules.map((r) => (
              <View key={r} style={{ flexDirection: "row", gap: S.md, alignItems: "flex-start" }}>
                <Icon name="alert-triangle" size={16} color={C.amber} style={{ marginTop: 4 }} />
                <Body style={{ flex: 1 }}>{r}</Body>
              </View>
            ))}
          </View>
          <Muted>The voice guide reads these aloud and asks: “{p.safety.check_in_question}”</Muted>
        </Section>

        {b.example_image_url ? (
          <Section index={2} title="Ideal shot">
            <View>
              <Image source={{ uri: b.example_image_url }} style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: C.surface }} resizeMode="cover" accessibilityLabel="Example ideal shot, AI-generated" />
              <Badge text="Example — AI-generated" bg={C.amber} color={C.onAmber} icon="alert-circle" style={{ position: "absolute", top: S.sm, left: S.sm }} />
            </View>
            <Muted>What a good capture looks like. Real captures only: there is no photo import.</Muted>
          </Section>
        ) : null}

        <Section index={b.example_image_url ? 3 : 2} title="What to capture">
          {p.capture.required_elements.map((e, i) => (
            <View key={e.id} style={{ flexDirection: "row", gap: S.md, alignItems: "flex-start" }}>
              <Text style={styles.stepIndex}>{indexLabel(i)}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: C.text, fontFamily: F.bodySemi, fontSize: T.body }}>{e.label}</Text>
                <Muted>{e.description}</Muted>
              </View>
            </View>
          ))}
          {p.capture.framing_tips.length ? <Divider /> : null}
          {p.capture.framing_tips.map((t) => (
            <View key={t} style={{ flexDirection: "row", gap: S.md, alignItems: "flex-start" }}>
              <Icon name="crosshair" size={15} color={C.muted} style={{ marginTop: 4 }} />
              <Muted style={{ flex: 1 }}>{t}</Muted>
            </View>
          ))}
        </Section>

        <Section index={b.example_image_url ? 4 : 3} title="Price lock">
          <Body color={C.muted} size={T.bodySmall}>
            Starting a capture locks the current price{top ? ` (${formatCents(top.price_cents)}, ${formatSurge(top.surge)})` : ""} for 15 minutes, so
            surge changes don't move the goalposts. Payout = locked price × quality (0.8–1.2).
          </Body>
        </Section>
      </ScrollView>

      {/* sticky primary action */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + S.md }]}>
        {startError ? <StatusPill tone={startError.settings ? "warn" : "bad"} text={startError.text} icon={startError.settings ? "map-pin" : undefined} /> : null}
        {startError?.settings ? (
          <Button title="Open Settings" kind="secondary" icon="settings" onPress={() => void Linking.openSettings().catch(() => undefined)} />
        ) : null}
        <Button
          title={allPaused ? "Captures paused" : "Start capture"}
          icon={allPaused ? "pause-circle" : "aperture"}
          onPress={() => void start()}
          loading={starting}
          disabled={allPaused}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safety: { gap: S.md, borderLeftWidth: 2, borderLeftColor: C.amber, paddingLeft: S.md },
  stepIndex: { color: C.muted, fontFamily: F.numeralRegular, fontSize: T.body, fontVariant: ["tabular-nums"], minWidth: 22, marginTop: 1 },
  footer: { paddingHorizontal: S.lg, paddingTop: S.md, gap: S.sm, backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
});
