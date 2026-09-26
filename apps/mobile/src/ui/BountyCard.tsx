import type { BountySummary } from "@groundtruth/shared";
import { Text, View } from "react-native";
import { distanceLabel, safetyLabel, timeLeft } from "../lib/feed";
import { Card, Muted, Price, StatusPill, SurgeBadge } from "./components";
import { C, S } from "./theme";

/** Card leads with a big price + surge badge (amber at ×2+), then distance, time, cells, safety. */
export function BountyCard({ b, onPress }: { b: BountySummary; onPress: () => void }) {
  const safety = safetyLabel(b.safety_level);
  return (
    <Card onPress={onPress} style={{ gap: S.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
        <Price cents={b.price_cents} size={36} />
        <SurgeBadge surge={b.surge} />
        {b.paused_cells > 0 ? <StatusPill tone="bad" text={`${b.paused_cells} paused`} /> : null}
      </View>
      <Text style={{ color: C.text, fontSize: 17, fontWeight: "700" }} numberOfLines={2}>
        {b.title}
      </Text>
      <Muted>{b.protocol_name}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
        <StatusPill tone="info" text={distanceLabel(b.distance_m)} />
        <StatusPill tone="neutral" text={timeLeft(b.ends_at)} />
        <StatusPill tone={b.cells_needed > 0 ? "warn" : "ok"} text={`${b.cells_needed}/${b.cells_total} cells needed`} />
        <StatusPill tone={safety.tone} text={safety.text} />
      </View>
      {b.match_reason ? <Muted style={{ fontStyle: "italic" }}>{b.match_reason}</Muted> : null}
    </Card>
  );
}
