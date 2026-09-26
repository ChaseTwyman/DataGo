import Feather from "@expo/vector-icons/Feather";
import { Redirect, Tabs } from "expo-router";
import { StyleSheet, type ColorValue } from "react-native";
import { useApp } from "../../src/state/appStore";
import type { IconName } from "../../src/ui/components";
import { C, F, TRACK } from "../../src/ui/theme";

const icon = (name: IconName) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Feather name={name} size={22} color={color as string} />;
  };

export default function TabsLayout() {
  const onboarded = useApp((s) => s.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.bg },
        headerShadowVisible: false,
        headerTintColor: C.text,
        headerTitleAlign: "left",
        headerTitleStyle: { fontFamily: F.display, fontSize: 17, letterSpacing: TRACK.wide },
        tabBarStyle: { backgroundColor: C.bg, borderTopColor: C.hairline, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 56 },
        tabBarLabelStyle: { fontFamily: F.display, fontSize: 12, letterSpacing: TRACK.label },
        tabBarActiveTintColor: C.text,
        tabBarInactiveTintColor: C.muted,
      }}
    >
      <Tabs.Screen name="map" options={{ title: "MAP", tabBarIcon: icon("map"), headerShown: false }} />
      <Tabs.Screen name="foryou" options={{ title: "FOR YOU", tabBarIcon: icon("crosshair") }} />
      <Tabs.Screen name="wallet" options={{ title: "WALLET", tabBarIcon: icon("credit-card") }} />
    </Tabs>
  );
}
