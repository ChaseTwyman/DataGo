/** Mission briefing (PRD §7.3): why it matters, safety, labeled AI example, locked-price note. */
import { formatCents, formatSurge, type CellPrice } from "@groundtruth/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { api, ApiError } from "../../src/api";
import { useBounty } from "../../src/api/queries";
import { timeLeft } from "../../src/lib/feed";
import { preciseFix } from "../../src/lib/useUserLocation";
import { useCaptureStore } from "../../src/state/captureStore";
import { Button, Card, ErrorBox, H, Muted, Price, StatusPill, SurgeBadge } from "../../src/ui/components";
import { C, S } from "../../src/ui/theme";

function bestCell(cov: CellPrice[]): CellPrice | null {
  return [...cov].filter((c) => !c.paused).sort((a, b) => b.price_cents - a.price_cents)[0] ?? null;
}

export default function BountyBriefing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useBounty(id);
  const put = useCaptureStore((s) => s.put);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (q.error) return <View style={{ padding: S.lg }}><ErrorBox message={q.error.message} onRetry={() => void q.refetch()} /></View>;
  const b = q.data;
  if (!b) return <View style={{ flex: 1, backgroundColor: C.bg, padding: S.lg }}><Muted>Loading briefing…</Muted></View>;
  const p = b.protocol;
  const top = bestCell(b.coverage);
  const allPaused = b.coverage.length > 0 && b.coverage.every((c) => c.paused);

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const fix = await preciseFix();
      const session = await api.createSession({ bounty_id: b.id, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracyM ?? 999 });
      put({ session, bounty: b });
      router.push(`/capture/${session.session_id}`);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: 48 }}>
      <View style={{ gap: S.sm }}>
        <H size={24}>{b.title}</H>
        <Muted>{p.name}</Muted>
        {top ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
            <Price cents={top.price_cents} size={40} />
            <SurgeBadge surge={top.surge} />
          </View>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
          <StatusPill tone="neutral" text={timeLeft(b.ends_at)} />
          <StatusPill tone="info" text={`Base ${formatCents(b.base_price_cents)} · up to ${formatCents(b.max_price_cents)}`} />
          {allPaused ? <StatusPill tone="bad" text="Paused: hazard warning" /> : null}
        </View>
      </View>

      <Card style={{ gap: S.sm }}>
        <H size={17}>Why it matters</H>
        <Text style={{ color: C.text, fontSize: 16, lineHeight: 23 }}>{b.summary || p.why_it_matters}</Text>
        {b.summary ? <Muted>{p.why_it_matters}</Muted> : null}
      </Card>

      <Card style={{ gap: S.sm, borderColor: C.amber }}>
        <StatusPill tone="warn" text={`Safety: ${p.safety.level}`} />
        {p.safety.rules.map((r) => (
          <Text key={r} style={{ color: C.text, fontSize: 15, lineHeight: 21 }}>
            ⚠︎ {r}
          </Text>
        ))}
        <Muted>The voice guide reads these aloud and asks: “{p.safety.check_in_question}”</Muted>
      </Card>

      {b.example_image_url ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <Image source={{ uri: b.example_image_url }} style={{ width: "100%", aspectRatio: 16 / 9 }} resizeMode="cover" accessibilityLabel="Example ideal shot, AI-generated" />
          <View style={{ position: "absolute", top: S.sm, left: S.sm, backgroundColor: C.overlay, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: C.amber, fontWeight: "900", letterSpacing: 0.5 }}>EXAMPLE — AI-generated</Text>
          </View>
          <View style={{ padding: S.md }}>
            <Muted>What a good capture looks like. Real captures only: there is no photo import.</Muted>
          </View>
        </Card>
      ) : null}

      <Card style={{ gap: S.sm }}>
        <H size={17}>What to capture</H>
        {p.capture.required_elements.map((e) => (
          <Text key={e.id} style={{ color: C.text, fontSize: 15 }}>
            ○ <Text style={{ fontWeight: "700" }}>{e.label}</Text> — {e.description}
          </Text>
        ))}
        {p.capture.framing_tips.map((t) => (
          <Muted key={t}>• {t}</Muted>
        ))}
      </Card>

      <Card style={{ gap: S.xs }}>
        <H size={17}>Your price is locked</H>
        <Muted>
          Starting a capture locks the current price{top ? ` (${formatCents(top.price_cents)}, ${formatSurge(top.surge)})` : ""} for 15 minutes, so
          surge changes don't move the goalposts. Payout = locked price × quality (0.8–1.2).
        </Muted>
      </Card>

      {startError ? <StatusPill tone="bad" text={startError} /> : null}
      <Button title={allPaused ? "Captures paused" : "Start capture"} icon="●" onPress={() => void start()} loading={starting} disabled={allPaused} />
    </ScrollView>
  );
}
