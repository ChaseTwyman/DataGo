/**
 * Bottom-sheet checklist: device rows + one row per required element + the server's "scene
 * verified" row (icon + color + text). Sized for a glance outdoors: 36 pt rows, 17 pt semibold
 * labels, solid ticks. When the scene cannot be verified a banner explains why and shows the retry.
 */
import type { Protocol } from "@groundtruth/shared";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, View } from "react-native";
import { Icon } from "../ui/components";
import { C, F, R, S, TRACK } from "../ui/theme";
import { checklistRows, verifyCause, verifyMessage, verifyStatus, type ChecklistRow, type GateState } from "./gateMachine";

/** `compact`: landscape side panel (short screen) — tighter rows, smaller type. */
export function ChecklistOverlay({ protocol, state, compact = false }: { protocol: Protocol; state: GateState; compact?: boolean }) {
  const rows = checklistRows(protocol, state);
  const done = rows.filter((r) => r.ok).length;
  return (
    <View style={{ gap: 2 }} accessibilityRole="list">
      <Text style={{ color: C.muted, fontFamily: F.display, fontSize: 13, letterSpacing: TRACK.label, marginBottom: S.xs }}>
        {`CHECKLIST · ${done}/${rows.length}`}
      </Text>
      {rows.map((r) => (
        <Row key={r.id} r={r} compact={compact} />
      ))}
      <VerifyBanner state={state} />
    </View>
  );
}

/**
 * CAN'T VERIFY SCENE: amber with a live retry indicator while we keep trying; red and static when
 * the server refused us or the session's check budget is spent (nothing left to retry).
 */
function VerifyBanner({ state }: { state: GateState }) {
  const v = verifyStatus(state);
  if (v !== "cant_verify" && v !== "failed" && v !== "exhausted") return null;
  const terminal = v !== "cant_verify";
  const color = terminal ? C.red : C.amber;
  const title = v === "exhausted" ? "CHECK LIMIT REACHED" : "CAN'T VERIFY SCENE";
  const detail = v === "cant_verify" ? `${verifyCause(state)} Shutter stays locked until the scene is verified.` : verifyMessage(state);
  return (
    <View style={[styles.banner, { borderColor: color }]} accessibilityLiveRegion="polite" accessibilityLabel={`${title}. ${detail ?? ""}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
        <Icon name={terminal ? "x-octagon" : "wifi-off"} size={16} color={color} />
        <Text style={[styles.bannerTitle, { color }]}>{title}</Text>
        {terminal ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <ActivityIndicator size="small" color={color} />
            <Text style={[styles.bannerMeta, { color }]}>{`RETRYING · ${state.attempts}/${state.frameLimit}`}</Text>
          </View>
        )}
      </View>
      <Text style={styles.bannerBody}>{detail}</Text>
      {/* state.fatal holds the raw server/exception text: logs only, never shown (canned copy above). */}
    </View>
  );
}

function Row({ r, compact }: { r: ChecklistRow; compact: boolean }) {
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: compact ? S.sm : S.md, minHeight: compact ? 28 : 36 }} accessibilityLabel={`${r.label}: ${r.ok ? "done" : "missing"}`}>
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
      <Text style={{ color: r.ok ? C.text : color, fontFamily: r.ok ? F.bodyMedium : F.bodySemi, fontSize: compact ? 15 : 17, flex: 1 }} numberOfLines={compact ? 1 : 2}>
        {r.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { marginTop: S.sm, borderWidth: 1, borderRadius: R.sm, padding: S.md, gap: S.xs, backgroundColor: C.bg },
  bannerTitle: { fontFamily: F.display, fontSize: 16, letterSpacing: TRACK.label },
  bannerMeta: { fontFamily: F.numeralRegular, fontSize: 13, letterSpacing: TRACK.label, fontVariant: ["tabular-nums"] },
  bannerBody: { color: C.text, fontFamily: F.body, fontSize: 15, lineHeight: 20 },
});
