import { formatCents, type MockVariant } from "@groundtruth/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useWallet } from "../../src/api/queries";
import { useApp } from "../../src/state/appStore";
import { Card, ErrorBox, H, Muted, StatusPill } from "../../src/ui/components";
import { C, S, TOUCH } from "../../src/ui/theme";
import { useCountUp } from "../../src/ui/useCountUp";

const VARIANTS: MockVariant[] = ["default", "screen_recapture", "missing_element"];

export default function Wallet() {
  const q = useWallet();
  const lastSeen = useApp((s) => s.lastSeenBalanceCents);
  const setLastSeen = useApp((s) => s.setLastSeenBalance);
  const balance = q.data?.balance_cents ?? null;
  // Count up from the last balance the user saw to the new one (e.g. right after a payout).
  const shown = useCountUp(balance, 1400, lastSeen);
  useEffect(() => {
    if (balance !== null) setLastSeen(balance);
  }, [balance, setLastSeen]);
  const { refetch } = q;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: S.lg, gap: S.md }}
      data={q.data?.entries ?? []}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => void q.refetch()} tintColor={C.accent} />}
      ListHeaderComponent={
        <View style={{ gap: S.md }}>
          <Card style={{ gap: S.xs, alignItems: "center", paddingVertical: S.xl }}>
            <Muted>Balance (simulated)</Muted>
            <Text style={{ color: C.green, fontSize: 48, fontWeight: "900", fontVariant: ["tabular-nums"] }} accessibilityLiveRegion="polite">
              {shown === null ? "—" : formatCents(shown)}
            </Text>
            {q.data ? <StatusPill tone="info" text={`Trust score ${q.data.trust_score.toFixed(2)}`} /> : null}
          </Card>
          {q.error ? <ErrorBox message={q.error.message} onRetry={() => void q.refetch()} /> : null}
          <H size={16}>History</H>
        </View>
      }
      ListEmptyComponent={q.isLoading ? <Muted>Loading…</Muted> : <Muted>No payouts yet. Accepted observations show up here.</Muted>}
      renderItem={({ item }) => (
        <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: C.text, fontWeight: "600" }}>{item.bounty_title ?? item.kind}</Text>
            <Muted>
              {item.kind} · {new Date(item.created_at).toLocaleString()}
            </Muted>
          </View>
          <Text style={{ color: item.amount_cents >= 0 ? C.green : C.red, fontWeight: "800", fontSize: 18 }}>
            {item.amount_cents >= 0 ? "+" : "−"}
            {formatCents(Math.abs(item.amount_cents))}
          </Text>
        </Card>
      )}
      ListFooterComponent={__DEV__ ? <DevSettings /> : null}
    />
  );
}

/** Dev-only: pick the x-mock-variant sent with frame checks and submissions (MOCK_GROK=1 demos). */
function DevSettings() {
  const variant = useApp((s) => s.mockVariant);
  const setVariant = useApp((s) => s.setMockVariant);
  const health = useApp((s) => s.health);
  const mode = useApp((s) => s.authMode);
  return (
    <Card style={{ gap: S.sm, marginTop: S.xl }}>
      <H size={16}>Developer</H>
      <Muted>
        Backend: {health?.backend ?? "?"} · auth: {mode ?? "?"} · mock Grok: {health?.mock_grok ? "on" : "off"} · realtime:{" "}
        {health?.realtime ? "on" : "polling"}
      </Muted>
      <Muted>Mock variant (x-mock-variant header):</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
        {VARIANTS.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ selected: v === variant }}
            onPress={() => setVariant(v)}
            style={{
              minHeight: TOUCH,
              paddingHorizontal: S.md,
              borderRadius: 10,
              justifyContent: "center",
              borderWidth: 1,
              borderColor: v === variant ? C.accent : C.border,
              backgroundColor: v === variant ? C.surface2 : "transparent",
            }}
          >
            <Text style={{ color: v === variant ? C.accent : C.text, fontWeight: "600" }}>
              {v === variant ? "● " : "○ "}
              {v}
            </Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
