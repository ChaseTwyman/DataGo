import { router } from "expo-router";
import { FlatList, Linking, Pressable, RefreshControl, View } from "react-native";
import { toUserMessage } from "../../src/api/errors";
import { useNearby } from "../../src/api/queries";
import { sortForYou } from "../../src/lib/feed";
import { MissionCard, useMissions, useNow } from "../../src/missions/MissionCard";
import { useUserLocation } from "../../src/lib/useUserLocation";
import { BountyCard } from "../../src/ui/BountyCard";
import { Button, EmptyState, ErrorBox, Label, LoadingState, StatusPill } from "../../src/ui/components";
import { C, S } from "../../src/ui/theme";

export { RouteErrorBoundary as ErrorBoundary } from "../../src/ui/ErrorFallback";

export default function ForYou() {
  const { loc, denied } = useUserLocation();
  const q = useNearby(loc, denied);
  const data = q.data ? sortForYou(q.data.bounties) : [];
  const missions = useMissions(loc, denied).data ?? [];
  const now = useNow(15_000);
  // Revisits you can act on: yours first, then open-to-all; closed ones drop out.
  const shownMissions = missions.filter((m) => Date.parse(m.closes_at) > now.getTime()).slice(0, 3);
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: S.lg, gap: S.md, paddingBottom: S.xxl }}
      data={data}
      keyExtractor={(b) => b.id}
      refreshControl={<RefreshControl refreshing={q.isFetching && !q.isLoading} onRefresh={() => void q.refetch()} tintColor={C.text} />}
      ListHeaderComponent={
        <View style={{ gap: S.sm }}>
          {shownMissions.length ? (
            <View style={{ gap: S.sm, marginBottom: S.sm }}>
              <Label>Revisits</Label>
              {shownMissions.map((m) => (
                <MissionCard key={m.id} m={m} now={now} />
              ))}
            </View>
          ) : null}
          {data.length ? <Label>{`${data.length} active · best match first`}</Label> : null}
          {denied ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Location is off. Open Settings to turn it on." onPress={() => void Linking.openSettings().catch(() => undefined)}>
              <StatusPill tone="warn" text="Location off · showing the demo area · tap for Settings" icon="map-pin" />
            </Pressable>
          ) : null}
          {q.error && !q.data ? <ErrorBox title="Couldn't load bounties" message={toUserMessage(q.error).message} onRetry={() => void q.refetch()} /> : null}
          {q.error && q.data ? <StatusPill tone="neutral" icon="wifi-off" text="Showing saved results · reconnecting…" /> : null}
        </View>
      }
      ListEmptyComponent={
        q.isLoading ? (
          <LoadingState label="Scanning for bounties…" />
        ) : q.error && !q.data ? null : (
          <EmptyState
            icon="radio"
            title="No bounties nearby"
            body="New bounties appear when researchers need data in your area. Pull down to check again."
            action={<Button title="Refresh" kind="secondary" icon="refresh-cw" onPress={() => void q.refetch()} />}
          />
        )
      }
      renderItem={({ item }) => <BountyCard b={item} onPress={() => router.push(`/bounty/${item.id}`)} />}
    />
  );
}
