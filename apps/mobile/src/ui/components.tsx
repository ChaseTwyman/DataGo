/**
 * Design-system primitives. Everything visual goes through these so screens stay consistent:
 * uppercase condensed headings, light tabular numerals, hairlines, one accent for money/primary.
 */
import Feather from "@expo/vector-icons/Feather";
import { isHotSurge } from "@groundtruth/shared";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { indexLabel, moneyParts, sponsorLine, surgeTag } from "./telemetry";
import { C, F, R, S, T, TOUCH, TRACK } from "./theme";

export type IconName = ComponentProps<typeof Feather>["name"];
export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

export function Icon({ name, size = 20, color = C.text, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  return <Feather name={name} size={size} color={color} style={style} accessibilityElementsHidden importantForAccessibility="no" />;
}

const TONE: Record<Tone, { color: string; icon: IconName }> = {
  ok: { color: C.green, icon: "check" },
  warn: { color: C.amber, icon: "alert-triangle" },
  bad: { color: C.red, icon: "x-octagon" },
  info: { color: C.blue, icon: "info" },
  neutral: { color: C.muted, icon: "minus" },
};
export const toneColor = (t: Tone) => TONE[t].color;
export const toneIcon = (t: Tone) => TONE[t].icon;

// ---------------------------------------------------------------- layout

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flex: 1, backgroundColor: C.bg }, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.hairline, alignSelf: "stretch" }, style]} />;
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  if (onPress)
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.card, pressed && { backgroundColor: C.surface2 }, style]}
      >
        {children}
      </Pressable>
    );
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Numbered section header: "01  WHY IT MATTERS" over a hairline. */
export function Section({ index, title, children, style, right }: { index?: number; title: string; children?: ReactNode; style?: StyleProp<ViewStyle>; right?: ReactNode }) {
  return (
    <View style={[{ gap: S.md }, style]}>
      <View style={{ gap: S.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
          {index !== undefined ? <Text style={styles.sectionIndex}>{indexLabel(index)}</Text> : null}
          <Text style={[styles.label, { color: C.text, flex: 1 }]} accessibilityRole="header">
            {title.toUpperCase()}
          </Text>
          {right}
        </View>
        <Divider />
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- type

export function Heading({ children, size = T.heading, color = C.text, style, lines }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle>; lines?: number }) {
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={lines}
      style={[{ color, fontFamily: F.display, fontSize: size, lineHeight: Math.round(size * 1.1), letterSpacing: TRACK.heading, textTransform: "uppercase" }, style]}
    >
      {children}
    </Text>
  );
}

/** Small uppercase tracked label (telemetry captions). */
export function Label({ children, color = C.muted, style }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.label, { color }, style]}>{typeof children === "string" ? children.toUpperCase() : children}</Text>;
}

export function Body({ children, color = C.text, style, size = T.body }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle>; size?: number }) {
  return <Text style={[{ color, fontFamily: F.body, fontSize: size, lineHeight: Math.round(size * 1.45) }, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Body color={C.muted} size={T.bodySmall} style={style}>{children}</Body>;
}

/** Back-compat alias. */
export const H = ({ children, size = T.title }: { children: ReactNode; size?: number }) => <Heading size={size}>{children}</Heading>;

// ---------------------------------------------------------------- numbers

/** Telemetry readout: small label over a large, light, tabular value with an optional unit. */
export function Readout({
  label,
  value,
  unit,
  size = T.numeral,
  color = C.text,
  style,
  align = "left",
}: {
  label: string;
  value: string;
  unit?: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  align?: "left" | "center" | "right";
}) {
  const alignItems = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
  return (
    <View style={[{ alignItems, gap: 2 }, style]} accessible accessibilityLabel={`${label} ${value} ${unit ?? ""}`.trim()}>
      <Label>{label}</Label>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={[styles.numeral, { color, fontSize: size, lineHeight: Math.round(size * 1.08) }]}>{value}</Text>
        {unit ? <Text style={[styles.unit, { fontSize: Math.max(T.label, Math.round(size * 0.34)) }]}>{unit}</Text> : null}
      </View>
    </View>
  );
}

/** Money set as large light dollars + smaller cents, in the accent color. */
export function Money({ cents, size = T.numeral, color = C.accent, prefix = "", style }: { cents: number; size?: number; color?: string; prefix?: string; style?: StyleProp<TextStyle> }) {
  const { major, minor } = moneyParts(cents);
  return (
    <Text style={[styles.numeral, { color, fontSize: size, lineHeight: Math.round(size * 1.08) }, style]} accessibilityLabel={`${prefix}${major}${minor}`}>
      {prefix}
      {major}
      <Text style={{ fontSize: Math.round(size * 0.55) }}>{minor}</Text>
    </Text>
  );
}

/** Back-compat alias. */
export function Price({ cents, size = T.numeral }: { cents: number; size?: number }) {
  return <Money cents={cents} size={size} />;
}

// ---------------------------------------------------------------- status

/** Status = icon + color + text (accessibility, BUILD_PROMPT §8). */
export function StatusPill({ tone, text, style, icon }: { tone: Tone; text: string; style?: StyleProp<ViewStyle>; icon?: IconName }) {
  const t = TONE[tone];
  return (
    <View style={[styles.pill, { borderColor: t.color }, style]} accessible accessibilityRole="text" accessibilityLabel={`${tone === "neutral" ? "" : `${tone}: `}${text}`}>
      <Icon name={icon ?? t.icon} size={14} color={t.color} />
      <Text style={[styles.pillText, { color: t.color }]}>{text.toUpperCase()}</Text>
    </View>
  );
}

/** Solid rectangular tag, e.g. "EXAMPLE — AI-GENERATED". */
export function Badge({ text, color = C.text, bg = C.surface2, icon, style }: { text: string; color?: string; bg?: string; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      {icon ? <Icon name={icon} size={13} color={color} /> : null}
      <Text style={[styles.badgeText, { color }]}>{text.toUpperCase()}</Text>
    </View>
  );
}

/** Surge: amber with an up-trend icon at ×2+, quiet outline below. */
export function SurgeBadge({ surge }: { surge: number }) {
  const hot = isHotSurge(surge);
  return (
    <View accessible accessibilityLabel={`${hot ? "high " : ""}surge ${surge.toFixed(1)} times`}>
      {hot ? (
        <Badge text={surgeTag(surge)} bg={C.amber} color={C.onAmber} icon="trending-up" />
      ) : (
        <Badge text={surgeTag(surge)} bg="transparent" color={C.muted} style={{ borderWidth: 1, borderColor: C.hairline }} />
      )}
    </View>
  );
}

/** "FUNDED BY <sponsor> · DATA FREE FOR EVERYONE"; renders nothing when there is no sponsor. */
export function SponsorLine({ name, url, style }: { name: string | null | undefined; url?: string | null; style?: StyleProp<ViewStyle> }) {
  const line = sponsorLine(name);
  if (!line) return null;
  const safeUrl = url && /^https?:\/\//i.test(url) ? url : null;
  const content = (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: S.sm }, style]}>
      <Icon name="award" size={14} color={C.muted} />
      <Text style={[styles.label, { color: C.muted, flex: 1 }]}>{line}</Text>
      {safeUrl ? <Icon name="external-link" size={14} color={C.muted} /> : null}
    </View>
  );
  if (!safeUrl) return content;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={line} onPress={() => void Linking.openURL(safeUrl)} style={{ minHeight: TOUCH, justifyContent: "center" }}>
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------- actions

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
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = kind === "primary" ? C.onAccent : kind === "danger" ? C.red : C.text;
  const off = !!disabled || !!loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        kind === "primary"
          ? { backgroundColor: disabled ? C.surface2 : C.accent }
          : { backgroundColor: "transparent", borderWidth: 1, borderColor: kind === "danger" ? C.red : C.hairline },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
          {icon ? <Icon name={icon} size={18} color={disabled && kind === "primary" ? C.muted : fg} /> : null}
          <Text style={[styles.buttonText, { color: disabled && kind === "primary" ? C.muted : fg }]}>{title.toUpperCase()}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color = C.text, style, role = "button", checked }: { icon: IconName; label: string; onPress: () => void; color?: string; style?: StyleProp<ViewStyle>; role?: "button" | "switch"; checked?: boolean }) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={role === "switch" ? { checked: !!checked } : undefined}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }, style]}
    >
      <Icon name={icon} size={20} color={color} />
    </Pressable>
  );
}

// ---------------------------------------------------------------- states

/**
 * Inline failure card. `message` must already be user copy — pass `toUserMessage(err).message`
 * (src/api/errors.ts), never `err.message`.
 */
export function ErrorBox({ message, onRetry, title = "Something went wrong" }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <View style={[styles.card, { borderColor: C.red, gap: S.md }]} accessibilityRole="alert">
      <StatusPill tone="bad" text={title} />
      <Body size={T.bodySmall} color={C.muted}>{message}</Body>
      {onRetry ? <Button title="Try again" kind="secondary" icon="refresh-cw" onPress={onRetry} /> : null}
    </View>
  );
}

/**
 * A permission the user turned off. Not an error: explain why, offer the system prompt while iOS
 * still allows it, otherwise deep-link to Settings.
 */
export function PermissionNeeded({
  icon,
  title,
  body,
  canAsk,
  onAsk,
  secondary,
}: {
  icon: IconName;
  title: string;
  body: string;
  canAsk: boolean;
  onAsk?: () => void;
  secondary?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", gap: S.lg, padding: S.xl }}>
      <Icon name={icon} size={28} color={C.amber} />
      <Heading size={T.title} style={{ textAlign: "center" }}>{title}</Heading>
      <Body color={C.muted} style={{ textAlign: "center" }}>{body}</Body>
      {canAsk && onAsk ? (
        <Button title="Allow access" icon="unlock" onPress={onAsk} style={{ alignSelf: "stretch" }} />
      ) : (
        <Button title="Open Settings" icon="settings" onPress={() => void Linking.openSettings().catch(() => undefined)} style={{ alignSelf: "stretch" }} />
      )}
      {secondary}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", gap: S.md, paddingVertical: S.xxl, paddingHorizontal: S.xl }}>
      <Icon name={icon} size={28} color={C.muted} />
      <Heading size={T.title} style={{ textAlign: "center" }}>{title}</Heading>
      {body ? <Muted style={{ textAlign: "center" }}>{body}</Muted> : null}
      {action}
    </View>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <View style={{ alignItems: "center", gap: S.md, paddingVertical: S.xxl }} accessibilityLiveRegion="polite">
      <ActivityIndicator color={C.text} />
      <Label>{label}</Label>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.md, padding: S.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
  label: { fontFamily: F.display, fontSize: T.label, letterSpacing: TRACK.label, textTransform: "uppercase" },
  sectionIndex: { fontFamily: F.numeralRegular, fontSize: T.label, color: C.muted, letterSpacing: TRACK.label, fontVariant: ["tabular-nums"] },
  numeral: { fontFamily: F.numeral, color: C.text, fontVariant: ["tabular-nums"], letterSpacing: 0.5 },
  unit: { fontFamily: F.display, color: C.muted, letterSpacing: TRACK.label },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: 10,
    minHeight: 28,
    gap: 6,
  },
  pillText: { fontFamily: F.display, fontSize: T.label, letterSpacing: 1.2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  badgeText: { fontFamily: F.display, fontSize: T.label, letterSpacing: 1.2, fontVariant: ["tabular-nums"] },
  button: { minHeight: 54, borderRadius: R.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: S.xl },
  buttonText: { fontFamily: F.display, fontSize: 17, letterSpacing: TRACK.wide },
  iconBtn: { minWidth: TOUCH, minHeight: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.overlay, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
});
