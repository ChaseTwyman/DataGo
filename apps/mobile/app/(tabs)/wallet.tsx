import { type MockVariant } from "@groundtruth/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { toUserMessage } from "../../src/api/errors";
import { useWallet } from "../../src/api/queries";
import { QueuedCaptures } from "../../src/offline/QueuedCaptures";
import { useApp } from "../../src/state/appStore";
import { Divider, EmptyState, ErrorBox, Icon, Label, LoadingState, Money, Muted, Readout, Section, StatusPill } from "../../src/ui/components";
import { C, F, R, S, T, TOUCH } from "../../src/ui/theme";
import { useCountUp } from "../../src/ui/useCountUp";

const VARIANTS: MockVariant[] = ["default", "screen_recapture", "missing_element"];

export { RouteErrorBoundary as ErrorBoundary } from "../../src/ui/ErrorFallback";

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
      contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl }}
      data={q.data?.entries ?? []}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={q.isFetching && !q.isLoading} onRefresh={() => void q.refetch()} tintColor={C.text} />}
      ItemSeparatorComponent={Divider}
      ListHeaderComponent={
        <View style={{ gap: S.xl, marginBottom: S.lg }}>
          <View style={{ gap: S.xs, paddingTop: S.md }} accessibilityLiveRegion="polite">
            <Label>Balance · simulated</Label>
            {shown === null ? (
              <Text style={{ color: C.muted, fontFamily: F.numeral, fontSize: T.numeralHero }}>—</Text>
            ) : (
              <Money cents={shown} size={T.numeralHero} />
            )}
          </View>
          {q.data ? (
            <View style={{ flexDirection: "row", gap: S.xl }}>
              <Readout label="Trust score" value={q.data.trust_score.toFixed(2)} size={28} />
              <Readout label="Entries" value={String(q.data.entries.length)} size={28} />
            </View>
          ) : null}
          {q.error && !q.data ? <ErrorBox title="Couldn't load wallet" message={toUserMessage(q.error).message} onRetry={() => void q.refetch()} /> : null}
          {q.error && q.data ? <StatusPill tone="neutral" icon="wifi-off" text="Showing last balance · reconnecting…" /> : null}
          <QueuedCaptures />
          <Section title="History" />
        </View>
      }
      ListEmptyComponent={
        q.isLoading ? (
          <LoadingState label="Loading ledger…" />
        ) : q.error && !q.data ? null : (
          <EmptyState icon="inbox" title="No payouts yet" body="Accepted observations are credited here the moment verification passes." />
        )
      }
      renderItem={({ item }) => {
        const credit = item.amount_cents >= 0;
        return (
          <View style={{ flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md, minHeight: TOUCH + 12 }}>
            <Icon name={credit ? "arrow-down-left" : "arrow-up-right"} size={18} color={credit ? C.green : C.red} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: C.text, fontFamily: F.bodyMedium, fontSize: T.body }} numberOfLines={1}>
                {item.bounty_title ?? item.kind}
              </Text>
              <Label>{`${item.kind} · ${new Date(item.created_at).toLocaleString()}`}</Label>
            </View>
            <Money cents={item.amount_cents} size={24} color={credit ? C.green : C.red} prefix={credit ? "+" : ""} />
          </View>
        );
      }}
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
    <Section title="Developer" style={{ marginTop: S.xxl }}>
      <Muted>
        Backend: {health?.backend ?? "?"} · auth: {mode ?? "?"} · mock Grok: {health?.mock_grok ? "on" : "off"} · realtime:{" "}
        {health?.realtime ? "on" : "polling"}
      </Muted>
      <Label>Mock variant (x-mock-variant header)</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
        {VARIANTS.map((v) => {
          const on = v === variant;
          return (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setVariant(v)}
              style={{
                minHeight: TOUCH,
                paddingHorizontal: S.md,
                borderRadius: R.sm,
                flexDirection: "row",
                alignItems: "center",
                gap: S.sm,
                borderWidth: 1,
                borderColor: on ? C.text : C.hairline,
              }}
            >
              <Icon name={on ? "check-circle" : "circle"} size={16} color={on ? C.text : C.muted} />
              <Text style={{ color: on ? C.text : C.muted, fontFamily: F.bodyMedium, fontSize: T.bodySmall }}>{v}</Text>
            </Pressable>
          );
        })}
      </View>
    </Section>
  );
}
