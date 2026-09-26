/**
 * Bottom-sheet checklist: device rows + one row per required element (icon + color + text).
 * Sized for a glance outdoors: 36 pt rows, 17 pt semibold labels, solid ticks.
 */
import type { Protocol } from "@groundtruth/shared";
import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { Icon } from "../ui/components";
import { C, F, S, TRACK } from "../ui/theme";
import { checklistRows, type ChecklistRow, type GateState } from "./gateMachine";

export function ChecklistOverlay({ protocol, state }: { protocol: Protocol; state: GateState }) {
  const rows = checklistRows(protocol, state);
  const done = rows.filter((r) => r.ok).length;
  return (
    <View style={{ gap: 2 }} accessibilityRole="list">
      <Text style={{ color: C.muted, fontFamily: F.display, fontSize: 13, letterSpacing: TRACK.label, marginBottom: S.xs }}>
        {`CHECKLIST · ${done}/${rows.length}`}
      </Text>
      {rows.map((r) => (
        <Row key={r.id} r={r} />
      ))}
      {state.degraded ? (
        <View style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start", marginTop: S.xs }}>
          <Icon name="alert-triangle" size={15} color={C.amber} style={{ marginTop: 2 }} />
          <Text style={{ color: C.amber, fontFamily: F.body, fontSize: 15, flex: 1 }}>Live AI check unavailable. Using device checks only (flagged for review).</Text>
        </View>
      ) : null}
    </View>
  );
}

function Row({ r }: { r: ChecklistRow }) {
  const color = r.ok ? C.green : r.kind === "integrity" ? C.red : C.amber;
  // Tick animation: a short scale pop when a row turns green.
  const scale = useRef(new Animated.Value(1)).current;
  const wasOk = useRef(r.ok);
  useEffect(() => {
    if (r.ok && !wasOk.current) {
      scale.setValue(0.6);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
    wasOk.current = r.ok;
  }, [r.ok, scale]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: S.md, minHeight: 36 }} accessibilityLabel={`${r.label}: ${r.ok ? "done" : "missing"}`}>
      <Animated.View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 2,
          borderColor: color,
          backgroundColor: r.ok ? color : "transparent",
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale }],
        }}
      >
        <Icon name={r.ok ? "check" : r.kind === "integrity" ? "x" : "minus"} size={16} color={r.ok ? C.bg : color} />
      </Animated.View>
      <Text style={{ color: r.ok ? C.text : color, fontFamily: r.ok ? F.bodyMedium : F.bodySemi, fontSize: 17, flex: 1 }} numberOfLines={2}>
        {r.label}
      </Text>
    </View>
  );
}
