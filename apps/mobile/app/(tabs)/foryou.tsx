import { router } from "expo-router";
import { FlatList, RefreshControl, View } from "react-native";
import { useNearby } from "../../src/api/queries";
import { sortForYou } from "../../src/lib/feed";
import { useUserLocation } from "../../src/lib/useUserLocation";
import { BountyCard } from "../../src/ui/BountyCard";
import { Button, EmptyState, ErrorBox, Label, LoadingState, StatusPill } from "../../src/ui/components";
import { C, S } from "../../src/ui/theme";

export default function ForYou() {
  const { loc, denied } = useUserLocation();
  const q = useNearby(loc, denied);
  const data = q.data ? sortForYou(q.data.bounties) : [];
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: S.lg, gap: S.md, paddingBottom: S.xxl }}
      data={data}
      keyExtractor={(b) => b.id}
      refreshControl={<RefreshControl refreshing={q.isFetching && !q.isLoading} onRefresh={() => void q.refetch()} tintColor={C.text} />}
      ListHeaderComponent={
        <View style={{ gap: S.sm }}>
          {data.length ? <Label>{`${data.length} active · best match first`}</Label> : null}
          {denied ? <StatusPill tone="warn" text="Location off · showing the demo area" icon="map-pin" /> : null}
          {q.error ? <ErrorBox title="Could not load bounties" message={q.error.message} onRetry={() => void q.refetch()} /> : null}
        </View>
      }
      ListEmptyComponent={
        q.isLoading ? (
          <LoadingState label="Scanning for bounties…" />
        ) : q.error ? null : (
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
