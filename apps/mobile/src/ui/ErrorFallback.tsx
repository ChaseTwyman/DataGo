/**
 * Friendly fallback for render crashes. Expo Router renders a route file's exported
 * `ErrorBoundary` instead of the screen when it throws; every route re-exports `RouteErrorBoundary`.
 * Deliberately uses system fonts and no app state: it must render even if fonts or stores failed.
 */
import Feather from "@expo/vector-icons/Feather";
import type { ErrorBoundaryProps } from "expo-router";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { log } from "../lib/log";
import { C, R, S, TOUCH } from "./theme";

export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    log.handled("render", error);
  }, [error]);
  const again = async () => {
    setBusy(true);
    try {
      await retry();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Feather name="alert-circle" size={30} color={C.amber} />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>This screen hit a problem. Your captures and wallet are safe.</Text>
      <Pressable accessibilityRole="button" onPress={() => void again()} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.8 }]}>
        {busy ? <ActivityIndicator color={C.bg} /> : <Text style={styles.primaryText}>Try again</Text>}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          try {
            router.replace("/map");
          } catch {
            void again();
          }
        }}
        style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.secondaryText}>Go to map</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: S.xl, gap: S.lg },
  title: { color: C.text, fontSize: 22, fontWeight: "700", textAlign: "center" },
  body: { color: C.muted, fontSize: 16, lineHeight: 22, textAlign: "center" },
  primary: { alignSelf: "stretch", minHeight: TOUCH + 8, borderRadius: R.sm, backgroundColor: C.text, alignItems: "center", justifyContent: "center" },
  primaryText: { color: C.bg, fontSize: 17, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  secondary: { alignSelf: "stretch", minHeight: TOUCH + 8, borderRadius: R.sm, borderWidth: 1, borderColor: C.hairline, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: C.text, fontSize: 17, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" },
});
