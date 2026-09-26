import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { boot } from "../src/api";
import { useApp } from "../src/state/appStore";
import { ErrorBox, Muted } from "../src/ui/components";
import { C, S } from "../src/ui/theme";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: C.surface, text: C.text, border: C.border, primary: C.accent },
};

function BootGate({ children }: { children: React.ReactNode }) {
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  useEffect(() => {
    void boot();
  }, []);
  if (ready) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: S.xl, gap: S.lg }}>
      {bootError ? (
        <>
          <ErrorBox message={bootError} onRetry={() => void boot()} />
          <Muted>Check EXPO_PUBLIC_API_BASE_URL (laptop LAN IP) and that `pnpm dev:web` is running.</Muted>
        </>
      ) : (
        <>
          <ActivityIndicator color={C.accent} size="large" />
          <Muted style={{ textAlign: "center" }}>Connecting to GroundTruth…</Muted>
        </>
      )}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <BootGate>
            <Stack screenOptions={{ headerStyle: { backgroundColor: C.surface }, headerTintColor: C.text, contentStyle: { backgroundColor: C.bg } }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding" options={{ title: "Welcome", headerShown: false }} />
              <Stack.Screen name="bounty/[id]" options={{ title: "Mission briefing" }} />
              <Stack.Screen name="capture/[sessionId]" options={{ headerShown: false, gestureEnabled: false }} />
              <Stack.Screen name="result/[submissionId]" options={{ title: "Verification", headerBackVisible: false, gestureEnabled: false }} />
              <Stack.Screen name="voice-test" options={{ title: "Voice test" }} />
            </Stack>
          </BootGate>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
