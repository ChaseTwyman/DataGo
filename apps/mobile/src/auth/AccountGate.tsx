/**
 * Root account gate (inside BootGate). Decides with the pure gateView(): only "app" mounts the
 * router Stack; every other state is a full-screen replacement, so signed-out or suspended users
 * can't reach any screen, including through deep links.
 */
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { signOut } from "../api";
import { gateView } from "../api/authFlow";
import { toUserMessage } from "../api/errors";
import { useMe } from "../api/queries";
import { log } from "../lib/log";
import { useApp } from "../state/appStore";
import { Body, Button, ErrorBox, Heading, Icon, Label, Muted } from "../ui/components";
import { C, S } from "../ui/theme";
import { AuthFlow } from "./AuthScreens";

export function AccountGate({ children }: { children: React.ReactNode }) {
  const ready = useApp((s) => s.ready);
  const session = useApp((s) => s.session);
  const suspendedFlag = useApp((s) => s.suspended);
  const me = useMe(ready && session === "signed_in");

  // A mid-use ACCOUNT_SUSPENDED sets the flag; only a /api/me fetched AFTER that (and saying not
  // suspended) clears it. Cached data from before the flag must not unblock the app.
  const flagAt = useRef(0);
  useEffect(() => {
    if (suspendedFlag) flagAt.current = Date.now();
  }, [suspendedFlag]);
  useEffect(() => {
    if (suspendedFlag && me.data && !me.data.suspended && me.dataUpdatedAt > flagAt.current) useApp.getState().setBoot({ suspended: false });
  }, [suspendedFlag, me.data, me.dataUpdatedAt]);

  const view = gateView({ ready, session, me: me.data ?? null, meError: me.isError && !me.data, suspendedFlag });

  // After a sign-out → sign-in in the same app run, the remounted Stack could restore the last
  // route (e.g. Account or a capture). Start from "/" instead, which routes through onboarding.
  const sawWelcome = useRef(false);
  useEffect(() => {
    if (view === "welcome") sawWelcome.current = true;
    if (view !== "app" || !sawWelcome.current) return;
    sawWelcome.current = false;
    const t = setTimeout(() => {
      try {
        router.replace("/");
      } catch (e) {
        log.handled("gate-reset-route", e);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [view]);

  if (view === "app") return <>{children}</>;
  if (view === "welcome") return <AuthFlow />;
  if (view === "suspended") return <Suspended onCheck={() => void me.refetch()} checking={me.isFetching} />;
  if (view === "account_error") {
    return (
      <Centered>
        <ErrorBox title="Couldn't load your account" message={toUserMessage(me.error).message} onRetry={() => void me.refetch()} />
        <SignOutButton />
      </Centered>
    );
  }
  return (
    <Centered>
      <View style={{ alignItems: "center", gap: S.md }} accessibilityLiveRegion="polite">
        <ActivityIndicator color={C.text} />
        <Label>Loading your account…</Label>
      </View>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: S.xl, gap: S.xl }}>{children}</View>;
}

function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      title="Sign out"
      kind="secondary"
      icon="log-out"
      loading={busy}
      onPress={() => {
        setBusy(true);
        void signOut().finally(() => setBusy(false));
      }}
    />
  );
}

function Suspended({ onCheck, checking }: { onCheck: () => void; checking: boolean }) {
  return (
    <Centered>
      <View style={{ gap: S.lg }} accessibilityRole="alert">
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
          <Icon name="slash" size={22} color={C.red} />
          <Label color={C.red}>Suspended</Label>
        </View>
        <Heading>Account suspended</Heading>
        <Body color={C.muted}>
          This account can't capture or earn right now. If you think this is a mistake, contact a GroundTruth admin.
        </Body>
      </View>
      <View style={{ gap: S.md }}>
        <Button title="Check again" kind="secondary" icon="refresh-cw" onPress={onCheck} loading={checking} />
        <SignOutButton />
        <Muted>Signing out doesn't delete anything.</Muted>
      </View>
    </Centered>
  );
}
