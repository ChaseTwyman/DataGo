import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { boot } from "../src/api";
import { isTransient } from "../src/api/errors";
import { useApp } from "../src/state/appStore";
import { ErrorBox, Label, Muted } from "../src/ui/components";
import { RouteErrorBoundary } from "../src/ui/ErrorFallback";
import { useAppFonts } from "../src/ui/fonts";
import { C, F, S, TRACK } from "../src/ui/theme";

/** Render crashes anywhere below the root show a calm fallback with "Try again" (Expo Router). */
export const ErrorBoundary = RouteErrorBoundary;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Transient failures (offline, 5xx, timeouts) retry quietly with backoff; 4xx do not.
      retry: (count, err) => count < 3 && isTransient(err),
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    },
  },
});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, text: C.text, border: C.hairline, primary: C.accent },
};

const MARK = require("../assets/splash-icon.png") as number;

/** Same mark as the native splash, so launch → connect reads as one continuous screen. */
function BootGate({ children }: { children: React.ReactNode }) {
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  useEffect(() => {
    void boot();
  }, []);
  if (ready) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: S.xl, gap: S.xl }}>
      <View style={{ alignItems: "center", gap: S.lg }}>
        <Image source={MARK} style={{ width: 96, height: 96 }} accessibilityLabel="GroundTruth" />
        <Label color={C.text} style={{ letterSpacing: 6, fontSize: 15 }}>GroundTruth</Label>
      </View>
      {bootError ? (
        <>
          <ErrorBox title="Can't connect" message={bootError} onRetry={() => void boot()} />
          {__DEV__ ? <Muted>Dev: check EXPO_PUBLIC_API_BASE_URL and that the API is running.</Muted> : null}
        </>
      ) : (
        <View style={{ alignItems: "center", gap: S.md }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={C.text} />
          <Label>Establishing link…</Label>
        </View>
      )}
    </View>
  );
}

const headerTitleStyle = { fontFamily: F.display, fontSize: 17, letterSpacing: TRACK.wide } as const;

export default function RootLayout() {
  const fontsReady = useAppFonts();
  // Black until fonts are in: the native splash is black too, so there is no flash of system type.
  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <BootGate>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: C.bg },
                headerShadowVisible: false,
                headerTintColor: C.text,
                headerTitleStyle,
                headerBackButtonDisplayMode: "minimal",
                contentStyle: { backgroundColor: C.bg },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding" options={{ headerShown: false }} />
              <Stack.Screen name="bounty/[id]" options={{ title: "BRIEFING" }} />
              <Stack.Screen name="capture/[sessionId]" options={{ headerShown: false, gestureEnabled: false }} />
              <Stack.Screen name="result/[submissionId]" options={{ title: "VERIFICATION", headerBackVisible: false, gestureEnabled: false }} />
              <Stack.Screen name="voice-test" options={{ title: "VOICE TEST" }} />
            </Stack>
          </BootGate>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
