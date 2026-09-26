import { router } from "expo-router";
import { FlatList, RefreshControl, View } from "react-native";
import { useNearby } from "../../src/api/queries";
import { sortForYou } from "../../src/lib/feed";
import { useUserLocation } from "../../src/lib/useUserLocation";
import { BountyCard } from "../../src/ui/BountyCard";
import { ErrorBox, Muted, StatusPill } from "../../src/ui/components";
import { C, S } from "../../src/ui/theme";

export default function ForYou() {
  const { loc, denied } = useUserLocation();
  const q = useNearby(loc, denied);
  const data = q.data ? sortForYou(q.data.bounties) : [];
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: S.lg, gap: S.md }}
      data={data}
      keyExtractor={(b) => b.id}
      refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => void q.refetch()} tintColor={C.accent} />}
      ListHeaderComponent={
        <View style={{ gap: S.sm }}>
          {denied ? <StatusPill tone="warn" text="Location off — showing the demo area" /> : null}
          {q.error ? <ErrorBox message={q.error.message} onRetry={() => void q.refetch()} /> : null}
        </View>
      }
      ListEmptyComponent={q.isLoading ? <Muted>Finding bounties near you…</Muted> : <Muted>No active bounties nearby right now.</Muted>}
      renderItem={({ item }) => <BountyCard b={item} onPress={() => router.push(`/bounty/${item.id}`)} />}
    />
  );
}
