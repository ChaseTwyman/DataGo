import type { BountySummary } from "@groundtruth/shared";
import { formatCents } from "@groundtruth/shared";
import { Text, View } from "react-native";
import { safetyLabel } from "../lib/feed";
import { Card, Divider, Icon, Label, Money, Readout, SponsorLine, StatusPill, SurgeBadge } from "./components";
import { distanceReadout, timeLeftReadout } from "./telemetry";
import { C, F, S, T } from "./theme";

/**
 * Bounty card: protocol + surge on top, the price as the largest thing on the card, the title, then
 * a telemetry strip (distance · time left · cells needed) and safety. One tap target: the card.
 */
export function BountyCard({ b, onPress }: { b: BountySummary; onPress: () => void }) {
  const safety = safetyLabel(b.safety_level);
  const dist = distanceReadout(b.distance_m);
  return (
    <Card onPress={onPress} label={`${b.title}, ${formatCents(b.price_cents)}, ${dist.value} ${dist.unit}. Open briefing.`} style={{ gap: S.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: S.sm }}>
        <Label style={{ flex: 1 }}>{b.protocol_name}</Label>
        <SurgeBadge surge={b.surge} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: S.md }}>
        <View style={{ flex: 1, gap: S.xs }}>
          <Money cents={b.price_cents} size={T.numeral} />
          <Text style={{ color: C.text, fontFamily: F.bodySemi, fontSize: 17, lineHeight: 23 }} numberOfLines={2}>
            {b.title}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color={C.muted} />
      </View>

      <Divider />
      <View style={{ flexDirection: "row", gap: S.lg }}>
        <Readout label="Distance" value={dist.value} unit={dist.unit} size={24} style={{ flex: 1 }} />
        <Readout label="Time left" value={timeLeftReadout(b.ends_at)} size={24} style={{ flex: 1 }} />
        <Readout label="Cells open" value={`${b.cells_needed}/${b.cells_total}`} size={24} style={{ flex: 1 }} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
        <StatusPill tone={safety.tone} text={safety.text} icon="shield" />
        {b.paused_cells > 0 ? <StatusPill tone="bad" text={`${b.paused_cells} cells paused`} /> : null}
      </View>
      {b.match_reason ? (
        <View style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}>
          <Icon name="user-check" size={15} color={C.muted} style={{ marginTop: 3 }} />
          <Text style={{ color: C.muted, fontFamily: F.body, fontSize: T.bodySmall, lineHeight: 21, flex: 1 }}>{b.match_reason}</Text>
        </View>
      ) : null}
      <SponsorLine name={b.sponsor_name} />
    </Card>
  );
}
