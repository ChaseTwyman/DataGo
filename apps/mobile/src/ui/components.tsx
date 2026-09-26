import { formatCents, formatSurge, isHotSurge } from "@groundtruth/shared";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { C, S, TOUCH } from "./theme";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

const TONE: Record<Tone, { color: string; icon: string }> = {
  ok: { color: C.green, icon: "✓" },
  warn: { color: C.amber, icon: "!" },
  bad: { color: C.red, icon: "✕" },
  info: { color: C.blue, icon: "i" },
  neutral: { color: C.muted, icon: "•" },
};

/** Status = icon + color + text (accessibility, BUILD_PROMPT §8). */
export function StatusPill({ tone, text, style }: { tone: Tone; text: string; style?: StyleProp<ViewStyle> }) {
  const t = TONE[tone];
  return (
    <View style={[styles.pill, { borderColor: t.color }, style]} accessibilityRole="text" accessibilityLabel={`${tone}: ${text}`}>
      <Text style={[styles.pillIcon, { color: t.color }]}>{t.icon}</Text>
      <Text style={[styles.pillText, { color: t.color }]}>{text}</Text>
    </View>
  );
}

export function SurgeBadge({ surge }: { surge: number }) {
  const hot = isHotSurge(surge);
  return (
    <View style={[styles.surge, { backgroundColor: hot ? C.amber : C.surface2 }]} accessibilityLabel={`surge ${formatSurge(surge)}`}>
      <Text style={[styles.surgeText, { color: hot ? "#1A1200" : C.text }]}>
        {hot ? "▲ " : ""}
        {formatSurge(surge)}
      </Text>
    </View>
  );
}

export function Price({ cents, size = 32 }: { cents: number; size?: number }) {
  return <Text style={{ color: C.text, fontSize: size, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{formatCents(cents)}</Text>;
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  loading,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = kind === "primary" ? C.accent : kind === "danger" ? C.red : C.surface2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={C.text} />
      ) : (
        <Text style={[styles.buttonText, { color: kind === "primary" ? "#04121F" : C.text }]}>
          {icon ? `${icon}  ` : ""}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }, style]} accessibilityRole="button">
        {children}
      </Pressable>
    );
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flex: 1, backgroundColor: C.bg }, style]}>{children}</View>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[{ color: C.muted, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}

export function H({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return <Text style={{ color: C.text, fontSize: size, fontWeight: "700" }}>{children}</Text>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ borderColor: C.red, gap: S.sm }}>
      <StatusPill tone="bad" text="Something went wrong" />
      <Muted>{message}</Muted>
      {onRetry ? <Button title="Retry" kind="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 6,
  },
  pillIcon: { fontWeight: "900", fontSize: 13 },
  pillText: { fontWeight: "600", fontSize: 13 },
  surge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  surgeText: { fontWeight: "800", fontSize: 14, fontVariant: ["tabular-nums"] },
  button: { minHeight: TOUCH + 8, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: S.lg },
  buttonText: { fontSize: 17, fontWeight: "700" },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: S.lg, borderWidth: 1, borderColor: C.border },
});
