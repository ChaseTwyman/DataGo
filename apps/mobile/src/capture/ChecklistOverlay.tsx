/** Bottom-sheet checklist: device rows + one row per required element (icon + color + text). */
import type { Protocol } from "@groundtruth/shared";
import { Text, View } from "react-native";
import { C, S } from "../ui/theme";
import { checklistRows, type GateState } from "./gateMachine";

export function ChecklistOverlay({ protocol, state }: { protocol: Protocol; state: GateState }) {
  const rows = checklistRows(protocol, state);
  return (
    <View style={{ gap: 6 }} accessibilityRole="list">
      {rows.map((r) => {
        const color = r.ok ? C.green : r.kind === "integrity" ? C.red : C.amber;
        return (
          <View
            key={r.id}
            style={{ flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 28 }}
            accessibilityLabel={`${r.label}: ${r.ok ? "done" : "missing"}`}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: color,
                backgroundColor: r.ok ? color : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: r.ok ? C.bg : color, fontWeight: "900", fontSize: 13 }}>{r.ok ? "✓" : r.kind === "integrity" ? "✕" : "○"}</Text>
            </View>
            <Text style={{ color: r.ok ? C.text : color, fontSize: 15, fontWeight: r.ok ? "500" : "700" }}>{r.label}</Text>
          </View>
        );
      })}
      {state.degraded ? (
        <Text style={{ color: C.amber, fontSize: 13 }}>! Live AI check unavailable — using device checks only (flagged for review).</Text>
      ) : null}
    </View>
  );
}
