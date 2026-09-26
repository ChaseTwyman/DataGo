/** Map-first home: bounty hex coverage + price badges (react-native-maps; Apple Maps on iOS). */
import { cellsForCircle, cellToPolygon, formatCents, formatSurge, isHotSurge, type BountySummary } from "@groundtruth/shared";
import { router } from "expo-router";
import { useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import MapView, { Marker, Polygon, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNearby } from "../../src/api/queries";
import { useUserLocation } from "../../src/lib/useUserLocation";
import { StatusPill } from "../../src/ui/components";
import { C, S, TOUCH } from "../../src/ui/theme";

function hexes(b: BountySummary) {
  return cellsForCircle(b.center_lat, b.center_lng, b.radius_m).map((cell) => ({
    cell,
    coords: (cellToPolygon(cell).coordinates[0] ?? []).map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
  }));
}

export default function MapTab() {
  const insets = useSafeAreaInsets();
  const { loc, denied } = useUserLocation();
  const q = useNearby(loc, denied);
  const bounties = useMemo(() => q.data?.bounties ?? [], [q.data]);
  const cells = useMemo(() => bounties.map((b) => ({ b, hexes: hexes(b) })), [bounties]);
  const mapRef = useRef<MapView>(null);

  const first = bounties[0];
  const initial: Region | undefined = loc
    ? { latitude: loc.lat, longitude: loc.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }
    : first
      ? { latitude: first.center_lat, longitude: first.center_lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }
      : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {initial ? (
        <MapView ref={mapRef} style={{ flex: 1 }} initialRegion={initial} showsUserLocation userInterfaceStyle="dark" showsPointsOfInterests={false}>
          {cells.map(({ b, hexes: hs }) =>
            hs.map((h) => (
              <Polygon
                key={`${b.id}:${h.cell}`}
                coordinates={h.coords}
                strokeColor={isHotSurge(b.surge) ? "rgba(255,176,32,0.9)" : "rgba(61,169,252,0.8)"}
                fillColor={isHotSurge(b.surge) ? "rgba(255,176,32,0.18)" : "rgba(61,169,252,0.14)"}
                strokeWidth={1}
                tappable
                onPress={() => router.push(`/bounty/${b.id}`)}
              />
            )),
          )}
          {bounties.map((b) => (
            <Marker
              key={b.id}
              coordinate={{ latitude: b.center_lat, longitude: b.center_lng }}
              onPress={() => router.push(`/bounty/${b.id}`)}
              accessibilityLabel={`${b.title}, ${formatCents(b.price_cents)}`}
            >
              <View
                style={{
                  backgroundColor: isHotSurge(b.surge) ? C.amber : C.surface,
                  borderColor: C.border,
                  borderWidth: 1,
                  borderRadius: 10,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  minHeight: 32,
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: isHotSurge(b.surge) ? "#1A1200" : C.text, fontWeight: "800" }}>
                  {formatCents(b.price_cents)} · {formatSurge(b.surge)}
                </Text>
              </View>
            </Marker>
          ))}
        </MapView>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <StatusPill tone="info" text="Waiting for location…" />
        </View>
      )}
      <View style={{ position: "absolute", top: insets.top + S.sm, left: S.lg, right: S.lg, gap: S.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ backgroundColor: C.overlay, borderRadius: 12, padding: S.sm }}>
            <Text style={{ color: C.text, fontWeight: "800", fontSize: 18 }}>GroundTruth</Text>
            <Text style={{ color: C.muted }}>{q.isLoading ? "Loading bounties…" : `${bounties.length} active nearby`}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/voice-test")}
            style={{ minHeight: TOUCH, minWidth: TOUCH, borderRadius: 12, backgroundColor: C.overlay, alignItems: "center", justifyContent: "center", paddingHorizontal: S.md }}
          >
            <Text style={{ color: C.text, fontWeight: "700" }}>🎙 Voice test</Text>
          </Pressable>
        </View>
        {denied ? <StatusPill tone="warn" text="Location off — showing the demo area" style={{ backgroundColor: C.overlay }} /> : null}
        {q.error ? <StatusPill tone="bad" text={q.error.message} style={{ backgroundColor: C.overlay }} /> : null}
      </View>
    </View>
  );
}
