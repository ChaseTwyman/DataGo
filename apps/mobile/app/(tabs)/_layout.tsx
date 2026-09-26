import { Redirect, Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useApp } from "../../src/state/appStore";
import { C } from "../../src/ui/theme";

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const onboarded = useApp((s) => s.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.surface },
        headerTintColor: C.text,
        tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.border, minHeight: 56 },
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.muted,
      }}
    >
      <Tabs.Screen name="map" options={{ title: "Map", tabBarIcon: icon("⬡"), headerShown: false }} />
      <Tabs.Screen name="foryou" options={{ title: "For you", tabBarIcon: icon("★") }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet", tabBarIcon: icon("$") }} />
    </Tabs>
  );
}
