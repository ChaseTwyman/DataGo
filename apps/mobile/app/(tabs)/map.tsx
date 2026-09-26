/** Map-first home: bounty hex coverage + price badges (react-native-maps; Apple Maps on iOS). */
import { cellsForCircle, cellToPolygon, DEMO, formatCents, formatSurge, isHotSurge, type BountySummary } from "@groundtruth/shared";
import { router } from "expo-router";
import { useMemo, useRef } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polygon, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toUserMessage } from "../../src/api/errors";
import { useNearby } from "../../src/api/queries";
import { sortForYou } from "../../src/lib/feed";
import { useUserLocation } from "../../src/lib/useUserLocation";
import { Icon, IconButton, Label, LoadingState, Money, StatusPill, SurgeBadge } from "../../src/ui/components";
import { distanceReadout, timeLeftReadout } from "../../src/ui/telemetry";
import { C, F, R, S, T, TOUCH, TRACK } from "../../src/ui/theme";

const HEX = {
  calm: { stroke: "rgba(214,228,255,0.75)", fill: "rgba(214,228,255,0.10)" },
  hot: { stroke: "rgba(255,176,32,0.9)", fill: "rgba(255,176,32,0.16)" },
};

function hexes(b: BountySummary) {
  return cellsForCircle(b.center_lat, b.center_lng, b.radius_m).map((cell) => ({
    cell,
    coords: (cellToPolygon(cell).coordinates[0] ?? []).map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
  }));
}

export { RouteErrorBoundary as ErrorBoundary } from "../../src/ui/ErrorFallback";

export default function MapTab() {
  const insets = useSafeAreaInsets();
  const { loc, denied } = useUserLocation();
  const q = useNearby(loc, denied);
  const bounties = useMemo(() => q.data?.bounties ?? [], [q.data]);
  const cells = useMemo(() => bounties.map((b) => ({ b, hexes: hexes(b) })), [bounties]);
  const top = useMemo(() => sortForYou(bounties)[0] ?? null, [bounties]);
  const mapRef = useRef<MapView>(null);

  const first = bounties[0];
  const initial: Region | undefined = loc
    ? { latitude: loc.lat, longitude: loc.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }
    : first
      ? { latitude: first.center_lat, longitude: first.center_lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }
      : denied || q.isFetched
        ? // No fix and no bounties: show the demo area rather than an endless spinner.
          { latitude: DEMO.lat, longitude: DEMO.lng, latitudeDelta: 0.06, longitudeDelta: 0.06 }
        : undefined;

  const recenter = () => {
    if (loc) mapRef.current?.animateToRegion({ latitude: loc.lat, longitude: loc.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {initial ? (
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          initialRegion={initial}
          showsUserLocation
          userInterfaceStyle="dark"
          showsPointsOfInterests={false}
          // Keep the Apple Maps "Legal" label visible above the top-pick card.
          mapPadding={{ top: 0, right: 0, bottom: top ? 180 : 0, left: 0 }}
        >
          {cells.map(({ b, hexes: hs }) =>
            hs.map((h) => {
              const tone = isHotSurge(b.surge) ? HEX.hot : HEX.calm;
              return (
                <Polygon
                  key={`${b.id}:${h.cell}`}
                  coordinates={h.coords}
                  strokeColor={tone.stroke}
                  fillColor={tone.fill}
                  strokeWidth={1}
                  tappable
                  onPress={() => router.push(`/bounty/${b.id}`)}
                />
              );
            }),
          )}
          {bounties.map((b) => {
            const hot = isHotSurge(b.surge);
            return (
              <Marker
                key={b.id}
                coordinate={{ latitude: b.center_lat, longitude: b.center_lng }}
                onPress={() => router.push(`/bounty/${b.id}`)}
                accessibilityLabel={`${b.title}, ${formatCents(b.price_cents)}, surge ${formatSurge(b.surge)}`}
              >
                <View style={[styles.marker, hot ? { backgroundColor: C.amber, borderColor: C.amber } : null]}>
                  {hot ? <Icon name="trending-up" size={13} color={C.onAmber} /> : null}
                  <Text style={[styles.markerText, { color: hot ? C.onAmber : C.text }]}>{formatCents(b.price_cents)}</Text>
                  <Text style={[styles.markerSurge, { color: hot ? C.onAmber : C.muted }]}>{formatSurge(b.surge)}</Text>
                </View>
              </Marker>
            );
          })}
        </MapView>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <LoadingState label="Acquiring position…" />
        </View>
      )}

      {/* HUD */}
      <View style={{ position: "absolute", top: insets.top + S.sm, left: S.lg, right: S.lg, gap: S.sm }} pointerEvents="box-none">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }} pointerEvents="box-none">
          <View style={styles.hud}>
            <Text style={styles.wordmark}>GROUNDTRUTH</Text>
            <Label>{q.isLoading ? "Scanning…" : `${bounties.length} active nearby`}</Label>
          </View>
          <View style={{ gap: S.sm }}>
            {/* Debug screen: development builds only, never in Release. */}
            {__DEV__ ? <IconButton icon="mic" label="Voice test" onPress={() => router.push("/voice-test")} /> : null}
            {loc ? <IconButton icon="navigation" label="Center on my location" onPress={recenter} /> : null}
          </View>
        </View>
        {denied ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Location is off. Open Settings to turn it on." onPress={() => void Linking.openSettings().catch(() => undefined)}>
            <StatusPill tone="warn" text="Location off · demo area · tap for Settings" icon="map-pin" style={{ backgroundColor: C.overlay }} />
          </Pressable>
        ) : null}
        {q.error ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Retry loading bounties" onPress={() => void q.refetch()}>
            <StatusPill
              tone={q.data ? "neutral" : "warn"}
              icon="wifi-off"
              text={q.data ? "Reconnecting…" : `${toUserMessage(q.error).title} · tap to retry`}
              style={{ backgroundColor: C.overlay }}
            />
          </Pressable>
        ) : null}
      </View>

      {/* Primary action: the best bounty for you, one tap to its briefing. */}
      {top ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Top pick: ${top.title}, ${formatCents(top.price_cents)}. Open briefing.`}
          onPress={() => router.push(`/bounty/${top.id}`)}
          style={({ pressed }) => [styles.pick, pressed && { backgroundColor: C.surface2 }]}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Label>Top pick</Label>
            <SurgeBadge surge={top.surge} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Money cents={top.price_cents} size={36} />
              <Text style={styles.pickTitle} numberOfLines={1}>
                {top.title}
              </Text>
              <Label>
                {(() => {
                  const d = distanceReadout(top.distance_m);
                  return `${d.value}${d.unit ? ` ${d.unit}` : ""} · ${timeLeftReadout(top.ends_at)} left · ${top.cells_needed} cells open`;
                })()}
              </Label>
            </View>
            <View style={styles.pickGo}>
              <Icon name="arrow-right" size={22} color={C.onAccent} />
            </View>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  marker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.bg,
    borderColor: C.hairline,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 8,
    minHeight: 32,
  },
  markerText: { fontFamily: F.numeralRegular, fontSize: 17, fontVariant: ["tabular-nums"] },
  markerSurge: { fontFamily: F.display, fontSize: 12, letterSpacing: 1 },
  hud: { backgroundColor: C.overlay, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: S.sm, gap: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
  wordmark: { color: C.text, fontFamily: F.display, fontSize: 16, letterSpacing: TRACK.wide + 1 },
  pick: {
    position: "absolute",
    left: S.lg,
    right: S.lg,
    bottom: S.lg,
    backgroundColor: C.scrim,
    borderRadius: R.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
    padding: S.lg,
    gap: S.sm,
  },
  pickTitle: { color: C.text, fontFamily: F.bodySemi, fontSize: T.body },
  pickGo: { width: TOUCH + 8, height: TOUCH + 8, borderRadius: R.sm, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
});
